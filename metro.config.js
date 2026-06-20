const path = require('path')
const { getDefaultConfig } = require('@react-native/metro-config')

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname)

module.exports = {
  ...defaultConfig,
  resolver: {
    ...defaultConfig.resolver,
    resolveRequest(context, moduleName, platform) {
      if (moduleName.startsWith('@/')) {
        const resolvedModuleName = path.resolve(__dirname, 'src', moduleName.slice(2))
        return context.resolveRequest(context, resolvedModuleName, platform)
      }
      return defaultConfig.resolver.resolveRequest
        ? defaultConfig.resolver.resolveRequest(context, moduleName, platform)
        : context.resolveRequest(context, moduleName, platform)
    },
    extraNodeModules: {
      // crypto: require.resolve('react-native-quick-crypto'),
      // stream: require.resolve('stream-browserify'),
      buffer: require.resolve('@craftzdog/react-native-buffer'),
    },
  },
}
