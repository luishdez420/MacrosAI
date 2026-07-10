const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.resolve(workspaceRoot, "packages"),
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  "@living-nutrition/api-client": path.resolve(workspaceRoot, "packages/api-client"),
  "@living-nutrition/design-tokens": path.resolve(workspaceRoot, "packages/design-tokens"),
  "@living-nutrition/shared-types": path.resolve(workspaceRoot, "packages/shared-types"),
  "@living-nutrition/validation": path.resolve(workspaceRoot, "packages/validation"),
};

module.exports = config;
