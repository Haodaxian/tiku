'use strict';
/**
 * 路径与固定配置。
 * 打包成单文件程序后，程序内部的资源是只读的，数据必须写在程序同级的 data 目录里。
 */
const path = require('path');

const PACKAGED = !!process.pkg;
const RES_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(RES_DIR, 'public');

// 打包后：exe 所在目录；开发时：项目根目录
const APP_DIR = PACKAGED ? path.dirname(process.execPath) : RES_DIR;
const DATA_DIR = process.env.TIKU_DATA ? path.resolve(process.env.TIKU_DATA) : path.join(APP_DIR, 'data');

// 内置模型，界面上不提供切换，避免老师选错
const VISION_MODEL = 'step-1o-turbo-vision';
const TEXT_MODEL = 'step-3.5-flash';

const MODEL_LABELS = {
  [VISION_MODEL]: { name: 'Step-1o Turbo Vision', use: '看图录题', note: '专用识图模型，响应快，单张试卷照片通常 3～8 秒' },
  [TEXT_MODEL]: { name: 'Step-3.5 Flash', use: '解题与讲义整理', note: '文本处理最快、单价最低，一份讲义成本不到 3 分钱' }
};

module.exports = {
  PACKAGED, RES_DIR, PUBLIC_DIR, APP_DIR, DATA_DIR,
  VISION_MODEL, TEXT_MODEL, MODEL_LABELS
};
