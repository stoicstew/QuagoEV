module.exports = {
  appId: 'com.quagoev.desktop',
  productName: 'QuagoEV',
  asar: true,
  directories: { output: 'release/desktop' },
  // The renderer is bundled by Vite; the shell needs only Electron/Node built-ins.
  // Keep all server and development dependency code out of desktop releases.
  files: ['dist/**/*', 'electron/**/*.cjs', '!electron/**/*.test.cjs', '!node_modules/**/*', 'package.json'],
  extraMetadata: { main: 'electron/main.cjs' },
  npmRebuild: false,
  mac: { category: 'public.app-category.travel', target: ['zip'], identity: null, icon: 'electron/assets/icon.png' },
  win: { target: ['zip'], signExecutable: false, icon: 'electron/assets/icon.png' },
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  publish: null,
};
