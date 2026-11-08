const path = require("node:path");
const prepareServerCompileCache = require("./prepare-server-compile-cache.cjs");

const ENTITLEMENTS = [
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.device.audio-input",
  "com.apple.security.device.camera",
];

module.exports = async (context) => {
  await prepareServerCompileCache(context);
  const identity = process.env.T3_SELF_SIGN_IDENTITY;
  if (context.electronPlatformName !== "darwin" || !identity) return;

  const { sign } = require("@electron/osx-sign");
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await sign({
    app,
    identity,
    identityValidation: false,
    keychain: process.env.T3_SELF_SIGN_KEYCHAIN,
    optionsForFile: () => ({ entitlements: ENTITLEMENTS }),
  });
  console.log(`[self-sign] signed ${app} with ${identity}`);
};
