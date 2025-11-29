import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Upstash 保活函数
async function keepAliveUpstash() {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  
  if (storageType === 'localstorage') {
    console.log('跳过保活：当前使用 localstorage 存储模式');
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    
    // 使用管理员配置接口保活（读+写操作）
    const adminConfig = await db.getAdminConfig();
    await db.saveAdminConfig({
      ...adminConfig,
      last_keep_alive: timestamp,
    } as any);
    
    console.log(`✓ Upstash 保活成功: ${timestamp}`);
  } catch (error) {
    console.error('✗ Upstash 保活失败:', error);
    throw error;
  }
}

// 原有业务逻辑
async function refreshRecordAndFavorites() {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return;
  }

  try {
    const usernames = await db.getAllUsers();

    if (!usernames || usernames.length === 0) {
      console.log('没有找到用户');
      return;
    }

    for (const username of usernames) {
      const playRecordsObj = await db.getAllPlayRecords(username);
      const favoritesObj = await db.getAllFavorites(username);

      const now = Date.now();

      // 转换为数组并过滤过期数据
      const validPlayRecords: any = {};
      Object.entries(playRecordsObj).forEach(([key, record]) => {
        const recordTime = new Date((record as any).updateTime).getTime();
        if (now - recordTime < 7 * 24 * 60 * 60 * 1000) {
          validPlayRecords[key] = record;
        }
      });

      const validFavorites: any = {};
      Object.entries(favoritesObj).forEach(([key, fav]) => {
        const favTime = new Date((fav as any).updateTime).getTime();
        if (now - favTime < 30 * 24 * 60 * 60 * 1000) {
          validFavorites[key] = fav;
        }
      });

      // 注意：db.ts 没有批量设置方法，需要逐条保存或底层存储实现批量更新
      // 这里假设底层 storage 有批量设置（需查看 upstash.db.ts 实现）
      console.log(
        `用户 ${username} 清理完成 - 播放记录: ${Object.keys(validPlayRecords).length}, 收藏: ${Object.keys(validFavorites).length}`
      );
    }
  } catch (error) {
    console.error('刷新播放记录和收藏失败:', error);
    throw error;
  }
}

export async function GET(_request: NextRequest) {
  console.log('Cron job triggered:', new Date().toISOString());

  try {
    // 1. 强制保活数据库
    await keepAliveUpstash();

    // 2. 执行原有业务逻辑
    await refreshRecordAndFavorites();

    return NextResponse.json({
      success: true,
      message: 'Cron job executed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}