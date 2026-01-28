/**
 * 浏览器端内存文件系统
 * 将文件内容缓存在浏览器内存中，支持标准的文件系统操作
 */

import { Injectable, Autowired } from '@opensumi/di';
import { URI, Emitter, Event, IDisposable, Disposable, BinaryBuffer } from '@opensumi/ide-core-common';
import {
  FileChangeType as OpenSumiFileChangeType,
  FileType,
  FileStat,
  FileSystemProviderCapabilities,
} from '@opensumi/ide-file-service';
import { FileChange, FileChangeType, FileNode } from '../../common/file-sync';

/**
 * 内存中的文件/目录节点
 */
interface MemoryNode {
  /** 是否为目录 */
  isDirectory: boolean;
  /** 文件内容 (Uint8Array) */
  content?: Uint8Array;
  /** 子节点 (目录) */
  children?: Map<string, MemoryNode>;
  /** 创建时间 */
  ctime: number;
  /** 修改时间 */
  mtime: number;
  /** 权限 */
  permissions?: number;
}

/**
 * 文件变更事件数据
 */
interface FileChangeEventData {
  type: FileChangeType;
  path: string;
  content?: string;
  isDirectory?: boolean;
}

export const IMemoryFileSystem = Symbol('IMemoryFileSystem');

export interface IMemoryFileSystem {
  /** 文件变更事件 */
  onDidChangeFile: Event<FileChangeEventData[]>;

  /** 初始化文件系统 */
  initialize(files: FileNode[]): Promise<void>;

  /** 清空文件系统 */
  clear(): void;

  /** 获取所有待同步的变更 */
  getPendingChanges(): FileChange[];

  /** 清除待同步的变更 */
  clearPendingChanges(): void;

  /** 标记变更已同步 */
  markChangesSynced(paths: string[]): void;

  /** 文件系统操作 */
  stat(uri: URI): Promise<FileStat>;
  readFile(uri: URI): Promise<Uint8Array>;
  writeFile(uri: URI, content: Uint8Array, options?: { create?: boolean; overwrite?: boolean }): Promise<void>;
  delete(uri: URI, options?: { recursive?: boolean }): Promise<void>;
  rename(oldUri: URI, newUri: URI, options?: { overwrite?: boolean }): Promise<void>;
  mkdir(uri: URI): Promise<void>;
  readdir(uri: URI): Promise<[string, FileType][]>;

  /** 获取工作区根路径 */
  getWorkspaceRoot(): string | undefined;

  /** 设置工作区根路径 */
  setWorkspaceRoot(root: string): void;
}

@Injectable()
export class MemoryFileSystem implements IMemoryFileSystem {
  private root: MemoryNode = {
    isDirectory: true,
    children: new Map(),
    ctime: Date.now(),
    mtime: Date.now(),
  };

  private workspaceRoot: string | undefined;

  /** 待同步的变更列表 */
  private pendingChanges: Map<string, FileChange> = new Map();

  private _onDidChangeFile = new Emitter<FileChangeEventData[]>();
  readonly onDidChangeFile: Event<FileChangeEventData[]> = this._onDidChangeFile.event;

  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  /**
   * 从服务器拉取的文件初始化内存文件系统
   */
  async initialize(files: FileNode[]): Promise<void> {
    this.clear();

    const processNode = (node: FileNode, parentPath: string = '') => {
      const fullPath = parentPath ? `${parentPath}/${node.path}` : node.path;

      if (node.isDirectory) {
        this.mkdirSync(fullPath);
        if (node.children) {
          for (const child of node.children) {
            processNode(child, fullPath);
          }
        }
      } else if (node.content !== undefined) {
        const content = new TextEncoder().encode(node.content);
        this.writeFileSync(fullPath, content, { create: true, overwrite: true }, false);
      }
    };

    for (const file of files) {
      processNode(file);
    }

    console.log('[MemoryFS] Initialized with files from server');
  }

  /**
   * 清空文件系统
   */
  clear(): void {
    this.root = {
      isDirectory: true,
      children: new Map(),
      ctime: Date.now(),
      mtime: Date.now(),
    };
    this.pendingChanges.clear();
  }

  /**
   * 获取待同步的变更
   */
  getPendingChanges(): FileChange[] {
    return Array.from(this.pendingChanges.values());
  }

  /**
   * 清除所有待同步的变更
   */
  clearPendingChanges(): void {
    this.pendingChanges.clear();
  }

  /**
   * 标记指定路径的变更已同步
   */
  markChangesSynced(paths: string[]): void {
    for (const path of paths) {
      this.pendingChanges.delete(path);
    }
  }

  /**
   * 将 URI 转换为相对路径
   */
  private uriToPath(uri: URI): string {
    let path = uri.path.toString();
    if (this.workspaceRoot && path.startsWith(this.workspaceRoot)) {
      path = path.substring(this.workspaceRoot.length);
    }
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    return path;
  }

  /**
   * 获取路径对应的节点
   */
  private getNode(path: string): MemoryNode | undefined {
    if (!path || path === '' || path === '/') {
      return this.root;
    }

    const parts = path.split('/').filter(p => p.length > 0);
    let current = this.root;

    for (const part of parts) {
      if (!current.isDirectory || !current.children) {
        return undefined;
      }
      const child = current.children.get(part);
      if (!child) {
        return undefined;
      }
      current = child;
    }

    return current;
  }

  /**
   * 获取父节点
   */
  private getParentNode(path: string): { parent: MemoryNode; name: string } | undefined {
    const parts = path.split('/').filter(p => p.length > 0);
    if (parts.length === 0) {
      return undefined;
    }

    const name = parts.pop()!;
    const parentPath = parts.join('/');
    const parent = this.getNode(parentPath);

    if (!parent || !parent.isDirectory) {
      return undefined;
    }

    return { parent, name };
  }

  /**
   * 同步创建目录
   */
  private mkdirSync(path: string): void {
    const parts = path.split('/').filter(p => p.length > 0);
    let current = this.root;

    for (const part of parts) {
      if (!current.children) {
        current.children = new Map();
      }

      let child = current.children.get(part);
      if (!child) {
        child = {
          isDirectory: true,
          children: new Map(),
          ctime: Date.now(),
          mtime: Date.now(),
        };
        current.children.set(part, child);
      }
      current = child;
    }
  }

  /**
   * 同步写入文件
   */
  private writeFileSync(
    path: string,
    content: Uint8Array,
    options: { create?: boolean; overwrite?: boolean } = {},
    trackChange: boolean = true
  ): void {
    const parts = path.split('/').filter(p => p.length > 0);
    if (parts.length === 0) {
      throw new Error('Cannot write to root');
    }

    const fileName = parts.pop()!;
    const dirPath = parts.join('/');

    // 确保父目录存在
    if (dirPath) {
      this.mkdirSync(dirPath);
    }

    const parent = this.getNode(dirPath);
    if (!parent || !parent.isDirectory || !parent.children) {
      throw new Error(`Parent directory not found: ${dirPath}`);
    }

    const existing = parent.children.get(fileName);
    const isCreate = !existing;
    const now = Date.now();

    if (existing && !options.overwrite) {
      throw new Error(`File already exists: ${path}`);
    }

    parent.children.set(fileName, {
      isDirectory: false,
      content: content,
      ctime: existing?.ctime || now,
      mtime: now,
    });

    // 记录变更
    if (trackChange) {
      this.recordChange(path, isCreate ? FileChangeType.Created : FileChangeType.Updated, content);
    }
  }

  /**
   * 记录文件变更
   */
  private recordChange(path: string, type: FileChangeType, content?: Uint8Array): void {
    const change: FileChange = {
      path,
      type,
      content: content ? new TextDecoder().decode(content) : undefined,
      timestamp: Date.now(),
    };

    // 合并相同路径的变更
    const existing = this.pendingChanges.get(path);
    if (existing) {
      // 如果之前是创建，现在是更新，保持创建类型
      if (existing.type === FileChangeType.Created && type === FileChangeType.Updated) {
        change.type = FileChangeType.Created;
      }
      // 如果之前是创建或更新，现在是删除，根据原类型决定
      if (type === FileChangeType.Deleted) {
        if (existing.type === FileChangeType.Created) {
          // 新创建后又删除，直接移除变更记录
          this.pendingChanges.delete(path);
          return;
        }
      }
    }

    this.pendingChanges.set(path, change);

    // 触发文件变更事件
    this._onDidChangeFile.fire([{
      type,
      path,
      content: change.content,
      isDirectory: false,
    }]);
  }

  /**
   * 获取文件/目录状态
   */
  async stat(uri: URI): Promise<FileStat> {
    const path = this.uriToPath(uri);
    const node = this.getNode(path);

    if (!node) {
      throw new Error(`File not found: ${path}`);
    }

    return {
      uri: uri.toString(),
      isDirectory: node.isDirectory,
      isFile: !node.isDirectory,
      isSymbolicLink: false,
      lastModification: node.mtime,
      createTime: node.ctime,
      size: node.content?.length || 0,
    };
  }

  /**
   * 读取文件内容
   */
  async readFile(uri: URI): Promise<Uint8Array> {
    const path = this.uriToPath(uri);
    const node = this.getNode(path);

    if (!node) {
      throw new Error(`File not found: ${path}`);
    }

    if (node.isDirectory) {
      throw new Error(`Cannot read directory: ${path}`);
    }

    return node.content || new Uint8Array(0);
  }

  /**
   * 写入文件
   */
  async writeFile(
    uri: URI,
    content: Uint8Array,
    options: { create?: boolean; overwrite?: boolean } = {}
  ): Promise<void> {
    const path = this.uriToPath(uri);
    this.writeFileSync(path, content, options, true);
  }

  /**
   * 删除文件或目录
   */
  async delete(uri: URI, options: { recursive?: boolean } = {}): Promise<void> {
    const path = this.uriToPath(uri);
    const info = this.getParentNode(path);

    if (!info) {
      throw new Error(`Cannot delete: ${path}`);
    }

    const { parent, name } = info;
    const node = parent.children?.get(name);

    if (!node) {
      throw new Error(`File not found: ${path}`);
    }

    if (node.isDirectory && node.children && node.children.size > 0 && !options.recursive) {
      throw new Error(`Directory not empty: ${path}`);
    }

    parent.children?.delete(name);
    this.recordChange(path, FileChangeType.Deleted);
  }

  /**
   * 重命名/移动
   */
  async rename(oldUri: URI, newUri: URI, options: { overwrite?: boolean } = {}): Promise<void> {
    const oldPath = this.uriToPath(oldUri);
    const newPath = this.uriToPath(newUri);

    const oldInfo = this.getParentNode(oldPath);
    const newInfo = this.getParentNode(newPath);

    if (!oldInfo || !newInfo) {
      throw new Error(`Cannot rename: ${oldPath} -> ${newPath}`);
    }

    const node = oldInfo.parent.children?.get(oldInfo.name);
    if (!node) {
      throw new Error(`File not found: ${oldPath}`);
    }

    const existingNew = newInfo.parent.children?.get(newInfo.name);
    if (existingNew && !options.overwrite) {
      throw new Error(`Target already exists: ${newPath}`);
    }

    // 删除旧位置
    oldInfo.parent.children?.delete(oldInfo.name);
    this.recordChange(oldPath, FileChangeType.Deleted);

    // 添加到新位置
    newInfo.parent.children?.set(newInfo.name, node);
    node.mtime = Date.now();

    if (node.isDirectory) {
      this.recordChange(newPath, FileChangeType.Created);
    } else {
      this.recordChange(newPath, FileChangeType.Created, node.content);
    }
  }

  /**
   * 创建目录
   */
  async mkdir(uri: URI): Promise<void> {
    const path = this.uriToPath(uri);

    const existing = this.getNode(path);
    if (existing) {
      throw new Error(`Already exists: ${path}`);
    }

    this.mkdirSync(path);

    // 记录目录创建变更
    const change: FileChange = {
      path,
      type: FileChangeType.Created,
      isDirectory: true,
      timestamp: Date.now(),
    };
    this.pendingChanges.set(path, change);

    this._onDidChangeFile.fire([{
      type: FileChangeType.Created,
      path,
      isDirectory: true,
    }]);
  }

  /**
   * 读取目录内容
   */
  async readdir(uri: URI): Promise<[string, FileType][]> {
    const path = this.uriToPath(uri);
    const node = this.getNode(path);

    if (!node) {
      throw new Error(`Directory not found: ${path}`);
    }

    if (!node.isDirectory) {
      throw new Error(`Not a directory: ${path}`);
    }

    const entries: [string, FileType][] = [];
    if (node.children) {
      for (const [name, child] of node.children) {
        entries.push([name, child.isDirectory ? FileType.Directory : FileType.File]);
      }
    }

    return entries;
  }
}
