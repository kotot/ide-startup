/**
 * 文件同步 Koa 中间件
 * 处理文件同步相关的 HTTP 请求
 */

import * as Koa from 'koa';
import * as bodyParser from 'koa-bodyparser';
import {
  FILE_SYNC_API,
  InitialPullRequest,
  BatchSyncRequest,
} from '../../common/file-sync';
import { IServerFileSyncService, ServerFileSyncService } from './file-sync.service';

/**
 * 创建文件同步中间件
 */
export function createFileSyncMiddleware(
  fileSyncService?: IServerFileSyncService
): Koa.Middleware {
  // 如果没有提供服务实例，创建一个新的
  const service = fileSyncService || new ServerFileSyncService();

  return async (ctx: Koa.Context, next: Koa.Next) => {
    const { path, method } = ctx;

    // 只处理 file-sync API 请求
    if (!path.startsWith('/api/file-sync')) {
      return next();
    }

    // CORS 头
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      ctx.status = 204;
      return;
    }

    try {
      switch (path) {
        case FILE_SYNC_API.HEALTH:
          // 健康检查
          ctx.body = {
            status: 'ok',
            timestamp: Date.now(),
          };
          break;

        case FILE_SYNC_API.PULL:
          // 处理拉取请求
          if (method !== 'POST') {
            ctx.status = 405;
            ctx.body = { error: 'Method not allowed' };
            return;
          }

          const pullRequest = ctx.request.body as InitialPullRequest;
          const pullResponse = await service.handlePull(pullRequest);
          ctx.body = pullResponse;
          break;

        case FILE_SYNC_API.SYNC:
          // 处理同步请求
          if (method !== 'POST') {
            ctx.status = 405;
            ctx.body = { error: 'Method not allowed' };
            return;
          }

          const syncRequest = ctx.request.body as BatchSyncRequest;
          const syncResponse = await service.handleSync(syncRequest);
          ctx.body = syncResponse;
          break;

        default:
          ctx.status = 404;
          ctx.body = { error: 'Not found' };
      }
    } catch (error) {
      console.error('[FileSyncMiddleware] Error:', error);
      ctx.status = 500;
      ctx.body = {
        error: 'Internal server error',
        message: String(error),
      };
    }
  };
}

/**
 * 创建包含 body parser 的文件同步中间件组
 */
export function createFileSyncMiddlewares(
  fileSyncService?: IServerFileSyncService
): Koa.Middleware[] {
  return [
    // JSON body parser (设置较大的限制以支持大文件同步)
    bodyParser({
      enableTypes: ['json'],
      jsonLimit: '50mb',
    }),
    // 文件同步中间件
    createFileSyncMiddleware(fileSyncService),
  ];
}
