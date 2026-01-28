/**
 * 内存文件系统模块贡献
 * 负责初始化和注册内存文件系统
 */

import { Injectable, Autowired } from '@opensumi/di';
import { Domain, ClientAppContribution, URI } from '@opensumi/ide-core-browser';
import { IFileServiceClient } from '@opensumi/ide-file-service/lib/browser';
import { IMemoryFileSystem } from './memory-file-system';
import { IFileSyncService, FileSyncConfig } from './file-sync.service';
import { IMemoryFsProvider, MEMORY_FS_SCHEME, MemoryFsProvider } from './memory-fs.provider';

@Injectable()
@Domain(ClientAppContribution)
export class MemoryFsContribution implements ClientAppContribution {
  @Autowired(IFileServiceClient)
  private fileServiceClient: IFileServiceClient;

  @Autowired(IMemoryFileSystem)
  private memoryFs: IMemoryFileSystem;

  @Autowired(IFileSyncService)
  private fileSyncService: IFileSyncService;

  @Autowired(IMemoryFsProvider)
  private memoryFsProvider: MemoryFsProvider;

  /**
   * 应用初始化时调用
   */
  async initialize() {
    // 初始化提供者
    this.memoryFsProvider.initialize();

    // 注册内存文件系统提供者到 file-service
    this.fileServiceClient.registerProvider(MEMORY_FS_SCHEME, this.memoryFsProvider as any);

    console.log('[MemoryFsContribution] Memory file system provider registered');
  }

  /**
   * 应用启动后调用
   */
  async onStart() {
    // 从 URL 参数获取配置
    const query = new URLSearchParams(window.location.search);
    const useMemoryFs = query.get('useMemoryFs') === 'true';

    if (!useMemoryFs) {
      console.log('[MemoryFsContribution] Memory file system is disabled');
      return;
    }

    const hostname = window.location.hostname;
    const port = process.env.DEVELOPMENT ? 8000 : window.location.port;
    const serverUrl = `${window.location.protocol}//${hostname}:${port}`;
    const workspaceDir = query.get('workspaceDir') || process.env.WORKSPACE_DIR || '/workspace';

    // 配置同步服务
    const config: FileSyncConfig = {
      serverUrl,
      workspaceDir,
      autoSyncInterval: parseInt(query.get('syncInterval') || '30000', 10), // 默认 30 秒
      debounceDelay: parseInt(query.get('debounceDelay') || '2000', 10), // 默认 2 秒
    };

    try {
      await this.fileSyncService.initialize(config);
      console.log('[MemoryFsContribution] File sync service initialized');
    } catch (error) {
      console.error('[MemoryFsContribution] Failed to initialize file sync service:', error);
    }
  }
}
