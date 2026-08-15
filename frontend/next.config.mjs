/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@rainbow-me/rainbowkit'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Stub all @x402 payment protocol subpaths (Coinbase CDP SDK — not used)
      '@x402/evm/upto/client':        false,
      '@x402/evm/exact/client':        false,
      '@x402/evm/upto/facilitator':    false,
      '@x402/evm/exact/facilitator':   false,
      '@x402/svm/upto/client':         false,
      '@x402/svm/exact/client':        false,
      '@x402/svm/upto/facilitator':    false,
      '@x402/svm/exact/facilitator':   false,
      // React Native dep pulled in by MetaMask SDK browser build
      '@react-native-async-storage/async-storage': false,
      // Optional pino prettifier (WalletConnect logger)
      'pino-pretty': false,
    }
    return config
  },
}

export default nextConfig
