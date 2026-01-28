/**
 * 内存文件系统浏览器模块
 * 提供在浏览器端管理代码的能力，通过 HTTP 批量同步到服务器
 */

import { Injectable, Provider } from '@opensumi/di';
import { BrowserModule } from '@opensumi/ide-core-browser';
import { MemoryFileSystem, IMemoryFileSystem } from './memory-file-system';
import { FileSyncService, IFileSyncService } from './file-sync.service';
import { MemoryFsProvider, IMemoryFsProvider } from './memory-fs.provider';
import { MemoryFsContribution } from './memory-fs.contribution';
import { SyncStatusContribution } from './sync-status.contribution';

export * from './memory-file-system';
export * from './file-sync.service';
export * from './memory-fs.provider';
export { MEMORY_FS_SCHEME } from './memory-fs.provider';

@Injectable()
export class MemoryFsModule extends BrowserModule {
  providers: Provider[] = [
    // 内存文件系统
    {
      token: IMemoryFileSystem,
      useClass: MemoryFileSystem,
    },
    // 文件同步服务
    {
      token: IFileSyncService,
      useClass: FileSyncService,
    },
    // 文件系统提供者
    {
      token: IMemoryFsProvider,
      useClass: MemoryFsProvider,
    },
    // 模块贡献
    MemoryFsContribution,
    // 状态栏贡献
    SyncStatusContribution,
  ];
}
