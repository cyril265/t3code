const path = require("node:path");
const prepareServerCompileCache = require("./prepare-server-compile-cache.cjs");

const RESOURCES = path.join(__dirname, "../apps/desktop/resources");

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
    keychain: process.env.T3_SELF_SIGN_KEYCHAIN || undefined,
    platform: "darwin",
    preAutoEntitlements: false,
    optionsForFile: (file) => ({
      hardenedRuntime: true,
      entitlements: path.join(
        RESOURCES,
        file === app ? "self-sign-app.entitlements.plist" : "self-sign-inherit.entitlements.plist",
      ),
    }),
  });
  console.log(`[self-sign] signed ${app} with ${identity}`);
};
