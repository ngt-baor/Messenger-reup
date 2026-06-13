const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const iconPath = path.join(context.packager.projectDir, 'icon.ico');
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);

  if (!fs.existsSync(exePath)) {
    throw new Error(`Cannot find Windows executable to set icon: ${exePath}`);
  }

  const { rcedit } = await import('rcedit');
  await rcedit(exePath, {
    icon: iconPath,
    'version-string': {
      ProductName: 'Messenger',
      FileDescription: 'Messenger',
    },
  });
};
