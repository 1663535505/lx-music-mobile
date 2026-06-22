import { memo, useCallback, useEffect, useState, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native'
import { useI18n } from '@/lang'
import { getDownloadStatus, stopDownload, clearDownload, type DownloadQueueState } from '@/core/download'
import { getDownloadRegistry, removeSongDownloaded, type DownloadRegistryItem } from '@/utils/data'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'

type Tab = 'queue' | 'downloaded'

type QueueItem = DownloadQueueState['batchQueue'][0]

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const [tab, setTab] = useState<Tab>('queue')
  const [state, setState] = useState<DownloadQueueState>(getDownloadStatus)
  const [downloaded, setDownloaded] = useState<Map<string, DownloadRegistryItem>>(new Map())

  useEffect(() => {
    const handler = (data: DownloadQueueState) => {
      setState({ ...data })
    }
    global.app_event.on('downloadProgressUpdate', handler)
    return () => {
      global.app_event.off('downloadProgressUpdate', handler)
    }
  }, [])

  const loadRegistry = useCallback(async() => {
    const registry = await getDownloadRegistry()
    setDownloaded(new Map(registry))
  }, [])

  useEffect(() => {
    if (tab === 'downloaded') void loadRegistry()
  }, [tab, loadRegistry])

  const handleStop = useCallback(() => {
    stopDownload()
  }, [])

  const handleClear = useCallback(() => {
    clearDownload()
  }, [])

  const handleRemoveDownloaded = useCallback(async(musicId: string, quality: string) => {
    await removeSongDownloaded(musicId, quality)
    void loadRegistry()
  }, [loadRegistry])

  // Combine all queue items for display
  const allItems = useMemo(() => {
    const items: QueueItem[] = []
    if (state.playTask) items.push(state.playTask)
    items.push(...state.pendingQueue)
    items.push(...state.batchQueue)
    return items
  }, [state])

  const totalCompleted = useMemo(() =>
    allItems.filter(q => q.status === 'completed' || q.status === 'skipped').length,
  [allItems])

  const isRunning = state.currentDownloading !== null

  const getStatusText = (item: QueueItem) => {
    switch (item.status) {
      case 'waiting': return '等待中'
      case 'downloading': return `${item.progress}%`
      case 'completed': return '完成'
      case 'skipped': return '已存在'
      case 'error': return item.error || '失败'
      case 'cancelled': return '已取消'
      default: return ''
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#4caf50'
      case 'skipped': return '#ff9800'
      case 'error': return '#f44336'
      case 'downloading': return theme['c-primary-font']
      default: return theme['c-font']
    }
  }

  const getQueueLabel = (item: QueueItem) => {
    if (state.playTask?.id === item.id) return '[播放] '
    if (state.pendingQueue.some(t => t.id === item.id)) return '[待播放] '
    return ''
  }

  const renderQueueItem = ({ item }: { item: QueueItem }) => (
    <View style={styles.item}>
      <View style={styles.itemInfo}>
        <Text style={[styles.songName, { color: theme['c-font'] }]} numberOfLines={1}>
          {getQueueLabel(item)}{item.musicInfo.name}
        </Text>
        <Text style={[styles.singer, { color: theme['c-font-label'] }]} numberOfLines={1}>
          {item.musicInfo.singer}
        </Text>
      </View>
      <Text style={[styles.status, { color: getStatusColor(item.status) }]}>
        {getStatusText(item)}
      </Text>
    </View>
  )

  const renderDownloadedItem = ({ item }: { item: [string, DownloadRegistryItem] }) => {
    const [key, entry] = item
    const parts = key.split('_')
    const quality = entry.quality
    const fileName = entry.filePath.split('/').pop() || ''
    return (
      <View style={styles.item}>
        <View style={styles.itemInfo}>
          <Text style={[styles.songName, { color: theme['c-font'] }]} numberOfLines={1}>
            {fileName}
          </Text>
          <Text style={[styles.singer, { color: theme['c-font-label'] }]} numberOfLines={1}>
            {quality} · {new Date(entry.downloadedAt).toLocaleDateString()}
          </Text>
        </View>
        <TouchableOpacity onPress={() => handleRemoveDownloaded(parts[0], quality)}>
          <Text style={[styles.status, { color: '#f44336' }]}>删除</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const downloadedEntries = Array.from(downloaded.entries())

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'queue' && styles.tabActive]}
          onPress={() => setTab('queue')}
        >
          <Text style={[styles.tabText, { color: tab === 'queue' ? theme['c-primary-font'] : theme['c-font-label'] }]}>
            下载队列
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'downloaded' && styles.tabActive]}
          onPress={() => setTab('downloaded')}
        >
          <Text style={[styles.tabText, { color: tab === 'downloaded' ? theme['c-primary-font'] : theme['c-font-label'] }]}>
            已下载 ({downloaded.size})
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'queue' ? (
        <>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme['c-font'] }]}>
              {totalCompleted}/{allItems.length}
            </Text>
            <View style={styles.buttons}>
              {isRunning && (
                <TouchableOpacity style={styles.button} onPress={handleStop}>
                  <Text style={[styles.buttonText, { color: theme['c-primary-font'] }]}>停止</Text>
                </TouchableOpacity>
              )}
              {allItems.length > 0 && !isRunning && (
                <TouchableOpacity style={styles.button} onPress={handleClear}>
                  <Text style={[styles.buttonText, { color: theme['c-primary-font'] }]}>清空</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          {allItems.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme['c-font-label'] }]}>暂无下载任务</Text>
            </View>
          ) : (
            <FlatList
              data={allItems}
              renderItem={renderQueueItem}
              keyExtractor={item => item.id}
              style={styles.list}
            />
          )}
        </>
      ) : (
        <>
          {downloadedEntries.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme['c-font-label'] }]}>暂无已下载歌曲</Text>
            </View>
          ) : (
            <FlatList
              data={downloadedEntries}
              renderItem={renderDownloadedItem}
              keyExtractor={item => item[0]}
              style={styles.list}
            />
          )}
        </>
      )}
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#4caf50',
  },
  tabText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttons: {
    flexDirection: 'row',
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  buttonText: {
    fontSize: 14,
  },
  list: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  songName: {
    fontSize: 14,
  },
  singer: {
    fontSize: 12,
    marginTop: 2,
  },
  status: {
    fontSize: 13,
    minWidth: 50,
    textAlign: 'right',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
})
