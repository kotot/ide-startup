/**
 * 内存文件系统提供者
 * 实现 OpenSumi FileSystemProvider 接口，将文件操作代理到内存文件系统
 */

import { Injectable, Autowired } from '@opensumi/di';
import {
  URI,
  Emitter,
  Event,
  IDisposable,
  Disposable,
  BinaryBuffer,
} from '@opensumi/ide-core-common';
import {
  FileSystemProviderCapabilities,
  FileType,
  FileStat,
  FileChangeEvent,
  FileChange as OpenSumiFileChange,
  FileChangeType as OpenSumiFileChangeType,
} from '@opensumi/ide-file-service';
import { IMemoryFileSystem } from './memory-file-system';
import { FileChangeType } from '../../common/file-sync';

export const MEMORY_FS_SCHEME = 'memory-fs';

export const IMemoryFsProvider = Symbol('IMemoryFsProvider');

export interface IMemoryFsProvider {
  /** 文件系统能力 */
  readonly capabilities: FileSystemProviderCapabilities;

  /** 文件变更事件 */
  onDidChangeFile: Event<FileChangeEvent>;

  /** 监听文件变更 */
  watch(uri: URI, options: { recursive: boolean; excludes: string[] }): number;

  /** 停止监听 */
  unwatch(watcherId: number): void;

  /** 获取文件/目录状态 */
  stat(uri: URI): Promise<FileStat>;

  /** 读取目录 */
  readDirectory(uri: URI): Promise<[string, FileType][]>;

  /** 创建目录 */
  createDirectory(uri: URI): Promise<void>;

  /** 读取文件 */
  readFile(uri: URI): Promise<Uint8Array>;

  /** 写入文件 */
  writeFile(
    uri: URI,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void>;

  /** 删除文件/目录 */
  delete(uri: URI, options: { recursive: boolean }): Promise<void>;

  /** 重命名/移动 */
  rename(oldUri: URI, newUri: URI, options: { overwrite: boolean }): Promise<void>;

  /** 复制 */
  copy?(source: URI, destination: URI, options: { overwrite: boolean }): Promise<void>;
}

@Injectable()
export class MemoryFsProvider implements IMemoryFsProvider, IDisposable {
  @Autowired(IMemoryFileSystem)
  private memoryFs: IMemoryFileSystem;

  private watcherIdCounter = 0;
  private watchers: Map<number, IDisposable> = new Map();

  readonly capabilities: FileSystemProviderCapabilities =
    FileSystemProviderCapabilities.FileReadWrite |
    FileSystemProviderCapabilities.FileOpenReadWriteClose;

  private _onDidChangeFile = new Emitter<FileChangeEvent>();
  readonly onDidChangeFile: Event<FileChangeEvent> = this._onDidChangeFile.event;

  constructor() {
    // 在构造函数之后初始化需要在 onDidChangeFile 之后进行
  }

  /**
   * 初始化，订阅内存文件系统的变更事件
   */
  initialize(): void {
    this.memoryFs.onDidChangeFile((changes) => {
      const openSumiChanges: OpenSumiFileChange[] = changes.map((change) => {
        const workspaceRoot = this.memoryFs.getWorkspaceRoot() || '';
        const fullPath = workspaceRoot ? `${workspaceRoot}/${change.path}` : change.path;

        return {
          uri: `${MEMORY_FS_SCHEME}://${fullPath}`,
          type: this.mapChangeType(change.type),
        };
      });

      if (openSumiChanges.length > 0) {
        this._onDidChangeFile.fire(openSumiChanges);
      }
    });
  }

  /**
   * 映射文件变更类型
   */
  private mapChangeType(type: FileChangeType): OpenSumiFileChangeType {
    switch (type) {
      case FileChangeType.Created:
        return OpenSumiFileChangeType.ADDED;
      case FileChangeType.Updated:
        return OpenSumiFileChangeType.UPDATED;
      case FileChangeType.Deleted:
        return OpenSumiFileChangeType.DELETED;
      default:
        return OpenSumiFileChangeType.UPDATED;
    }
  }

  /**
   * 监听文件变更
   */
  watch(uri: URI, options: { recursive: boolean; excludes: string[] }): number {
    const watcherId = ++this.watcherIdCounter;
    // 内存文件系统的变更会自动通过 onDidChangeFile 事件通知
    // 这里只需要记录 watcher
    this.watchers.set(watcherId, Disposable.NULL);
    return watcherId;
  }

  /**
   * 停止监听
   */
  unwatch(watcherId: number): void {
    const watcher = this.watchers.get(watcherId);
    if (watcher) {
      watcher.dispose();
      this.watchers.delete(watcherId);
    }
  }

  /**
   * 获取文件/目录状态
   */
  async stat(uri: URI): Promise<FileStat> {
    return this.memoryFs.stat(uri);
  }

  /**
   * 读取目录
   */
  async readDirectory(uri: URI): Promise<[string, FileType][]> {
    return this.memoryFs.readdir(uri);
  }

  /**
   * 创建目录
   */
  async createDirectory(uri: URI): Promise<void> {
    return this.memoryFs.mkdir(uri);
  }

  /**
   * 读取文件
   */
  async readFile(uri: URI): Promise<Uint8Array> {
    return this.memoryFs.readFile(uri);
  }

  /**
   * 写入文件
   */
  async writeFile(
    uri: URI,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    return this.memoryFs.writeFile(uri, content, options);
  }

  /**
   * 删除文件/目录
   */
  async delete(uri: URI, options: { recursive: boolean }): Promise<void> {
    return this.memoryFs.delete(uri, options);
  }

  /**
   * 重命名/移动
   */
  async rename(oldUri: URI, newUri: URI, options: { overwrite: boolean }): Promise<void> {
    return this.memoryFs.rename(oldUri, newUri, options);
  }

  /**
   * 复制
   */
  async copy(source: URI, destination: URI, options: { overwrite: boolean }): Promise<void> {
    const content = await this.memoryFs.readFile(source);
    await this.memoryFs.writeFile(destination, content, { create: true, overwrite: options.overwrite });
  }

  /**
   * 销毁
   */
  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    this._onDidChangeFile.dispose();
  }
}
