// 给 Windows exe 换图标与文件属性（pkg 6 已内置去掉 --icon 参数，这里自己改 PE 资源）
const fs = require('fs');
const path = require('path');
const R = require('resedit');

const { NtExecutable, NtExecutableResource, Resource, Data } = R;

const exePath = process.argv[2];
const icoPath = process.argv[3] || path.join(__dirname, '..', 'app.ico');
if (!exePath) {
  console.error('用法：node tools/inject-icon.js <exe> [ico]');
  process.exit(1);
}

const exeData = fs.readFileSync(exePath);
const exeFile = NtExecutable.from(exeData, { ignoreCert: true });
const res = NtExecutableResource.from(exeFile);

const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
const groups = Resource.IconGroupEntry.fromEntries(res.entries) || [];
const groupId = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  groupId,
  lang,
  iconFile.icons.map((i) => i.data)
);

try {
  const vi = Resource.VersionInfo.fromEntries(res.entries);
  if (vi && vi.length) {
    vi[0].setStringValues({
      ProductName: '题库与讲义系统',
      FileDescription: '题库与讲义系统',
      CompanyName: '个人版',
      FileVersion: '1.3.0',
      ProductVersion: '1.3.0',
      LegalCopyright: ''
    });
    vi[0].outputToResourceEntries(res.entries);
  }
} catch (e) {
  console.warn('版本信息写入失败（不影响使用）：' + e.message);
}

res.outputResource(exeFile);
fs.writeFileSync(exePath, Buffer.from(exeFile.generate()));
console.log('图标已写入：' + exePath);
