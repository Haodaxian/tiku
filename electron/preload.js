'use strict';
/**
 * 预加载脚本：只把必要的能力暴露给页面，其余一律不给。
 * 页面里通过 window.tikuElectron.print() 触发系统打印框。
 *
 * @author zz_lxf
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tikuElectron', {
  /** 是否运行在桌面客户端里 */
  isDesktop: true,
  /** 触发系统打印框 */
  print: () => ipcRenderer.invoke('tiku-print'),
  /** 导出 PDF（返回 base64） */
  printPdf: () => ipcRenderer.invoke('tiku-print-pdf'),
  /** 弹出保存对话框并写文件 */
  saveFile: (opts) => ipcRenderer.invoke('tiku-save-file', opts),
  /** 数据目录 */
  dataDir: () => ipcRenderer.invoke('tiku-data-dir'),
  /** 用系统文件管理器打开数据目录 */
  openDataDir: () => ipcRenderer.invoke('tiku-open-data-dir'),
  /** 接收主进程菜单发来的打印指令 */
  onMenuPrint: (cb) => ipcRenderer.on('menu-print', () => cb && cb())
});
