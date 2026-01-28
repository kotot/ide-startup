/**
 * 同步状态贡献
 * 在状态栏显示文件同步状态
 */

import { Injectable, Autowired } from '@opensumi/di';
import {
  Domain,
  CommandContribution,
  CommandRegistry,
  Command,
  localize,
} from '@opensumi/ide-core-browser';
import {
  StatusBarAlignment,
  IStatusBarService,
} from '@opensumi/ide-core-browser/lib/services';
import { IFileSyncService, SyncStatus } from './file-sync.service';

export const SYNC_STATUS_ID = 'file-sync-status';

export const SYNC_COMMANDS = {
  MANUAL_SYNC: {
    id: 'memoryFs.manualSync',
    label: 'Sync Files to Server',
  } as Command,
};

@Injectable()
@Domain(CommandContribution)
export class SyncStatusContribution implements CommandContribution {
  @Autowired(IStatusBarService)
  private statusBarService: IStatusBarService;

  @Autowired(IFileSyncService)
  private fileSyncService: IFileSyncService;

  private isInitialized = false;

  registerCommands(commands: CommandRegistry): void {
    // 注册手动同步命令
    commands.registerCommand(SYNC_COMMANDS.MANUAL_SYNC, {
      execute: async () => {
        try {
          const result = await this.fileSyncService.sync();
          if (result.success) {
            console.log(`[SyncStatus] Manual sync completed: ${result.syncedCount} files`);
          } else {
            console.error('[SyncStatus] Manual sync failed:', result.error);
          }
        } catch (error) {
          console.error('[SyncStatus] Manual sync error:', error);
        }
      },
    });

    // 初始化状态栏
    this.initializeStatusBar();
  }

  private initializeStatusBar(): void {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;

    // 检查是否启用内存文件系统
    const query = new URLSearchParams(window.location.search);
    const useMemoryFs = query.get('useMemoryFs') === 'true';

    if (!useMemoryFs) {
      return;
    }

    // 设置初始状态
    this.updateStatusBar(SyncStatus.Idle, 0);

    // 监听状态变化
    this.fileSyncService.onStatusChange((status) => {
      const pendingCount = this.fileSyncService.getPendingChangesCount();
      this.updateStatusBar(status, pendingCount);
    });

    // 监听同步完成
    this.fileSyncService.onSyncComplete((result) => {
      const pendingCount = this.fileSyncService.getPendingChangesCount();
      this.updateStatusBar(
        result.success ? SyncStatus.Idle : SyncStatus.Error,
        pendingCount
      );
    });
  }

  private updateStatusBar(status: SyncStatus, pendingCount: number): void {
    let text: string;
    let tooltip: string;
    let backgroundColor: string | undefined;

    switch (status) {
      case SyncStatus.Syncing:
        text = '$(sync~spin) Syncing...';
        tooltip = 'Syncing files to server';
        backgroundColor = undefined;
        break;
      case SyncStatus.Error:
        text = '$(error) Sync Error';
        tooltip = 'Failed to sync files. Click to retry.';
        backgroundColor = 'statusBarItem.errorBackground';
        break;
      case SyncStatus.Idle:
      default:
        if (pendingCount > 0) {
          text = `$(cloud-upload) ${pendingCount} pending`;
          tooltip = `${pendingCount} files waiting to sync. Click to sync now.`;
        } else {
          text = '$(check) Synced';
          tooltip = 'All files are synced';
        }
        backgroundColor = undefined;
        break;
    }

    this.statusBarService.addElement(SYNC_STATUS_ID, {
      text,
      tooltip,
      backgroundColor,
      alignment: StatusBarAlignment.RIGHT,
      priority: 100,
      command: SYNC_COMMANDS.MANUAL_SYNC.id,
    });
  }
}
