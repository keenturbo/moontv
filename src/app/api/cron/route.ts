import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db.client';

const db = getDB();

// Upstash 保活函数
async function keepAliveUpstash() {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  
  if (storageType === 'localstorage') {
    console.log('跳过保活：当前使用 localstorage 存储模式');
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    const keepAliveUser = 'system_keep_alive';
    
    // 使用现有接口：写入虚拟用户配置
    await db.setUserConfig(keepAliveUser, {
      last_ping: timestamp,
      purpose: 'database_keep_alive',
    });
    
    // 读取确认
    const config = await db.getUserConfig(keepAliveUser);
    
    console.log(`✓ Upstash 保活成功: ${timestamp}`, config);
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
    const users = await db.getAllUsers();

    if (!users || users.length === 0) {
      console.log('没有找到用户');
      return;
    }

    for (const user of users) {
      const { username } = user;
      let playRecords = await db.getPlayRecords(username);
      let favorites = await db.getFavorites(username);

      const now = Date.now();

      // 过滤过期播放记录（7天）
      playRecords = playRecords.filter((record: any) => {
        const recordTime = new Date(record.updateTime).getTime();
        return now - recordTime < 7 * 24 * 60 * 60 * 1000;
      });

      // 过滤过期收藏（30天）
      favorites = favorites.filter((fav: any) => {
        const favTime = new Date(fav.updateTime).getTime();
        return now - favTime < 30 * 24 * 60 * 60 * 1000;
      });

      await db.setPlayRecords(username, playRecords);
      await db.setFavorites(username, favorites);

      console.log(
        `用户 ${username} 的播放记录和收藏已更新:`,
        playRecords.length,
        favorites.length
      );
    }
  } catch (error) {
    console.error('刷新播放记录和收藏失败:', error);
    throw error;
  }
}

export async function GET(request: NextRequest) {
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