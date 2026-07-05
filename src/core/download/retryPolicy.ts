import settingState from '@/store/setting/state'

export interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
}

export const getRetryConfig = (): RetryConfig => {
  return {
    ...DEFAULT_CONFIG,
    maxRetries: settingState.setting['download.maxRetries'] ?? 3,
  }
}

export const getRetryDelay = (attempt: number, config: RetryConfig = getRetryConfig()): number => {
  const delay = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs)
  const jitter = Math.random() * 1000
  return delay + jitter
}

export const shouldRetry = (retryCount: number, config: RetryConfig = getRetryConfig()): boolean => {
  return retryCount < config.maxRetries
}
