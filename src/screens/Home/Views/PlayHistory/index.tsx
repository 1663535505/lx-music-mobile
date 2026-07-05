import { memo, useCallback, useMemo, useState } from 'react'
import { View, FlatList, TouchableOpacity, StyleSheet } from 'react-native'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { usePlayHistory } from '@/store/playHistory/hook'
import { removePlayHistoryEntry, clearPlayHistory } from '@/core/playHistory'
import { addTempPlayList } from '@/core/player/tempPlayList'
import { createStyle, confirmDialog, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { LIST_ITEM_HEIGHT } from '@/config/constant'
import { scaleSizeH } from '@/utils/pixelRatio'

type Tab = 'recent' | 'most' | 'top25_recent' | 'top25_most'

const TOP_N = 25

const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`
  return new Date(timestamp).toLocaleDateString()
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const [tab, setTab] = useState<Tab>('recent')
  const { recentlyPlayed, mostPlayed } = usePlayHistory()

  const data = useMemo(() => {
    switch (tab) {
      case 'recent': return recentlyPlayed
      case 'most': return mostPlayed
      case 'top25_recent': return recentlyPlayed.slice(0, TOP_N)
      case 'top25_most': return mostPlayed.slice(0, TOP_N)
    }
  }, [tab, recentlyPlayed, mostPlayed])

  const isSmartList = tab === 'top25_recent' || tab === 'top25_most'

  const handleClear = useCallback(async() => {
    const confirmed = await confirmDialog({
      message: t('play_history_clear_confirm'),
      cancelButtonText: t('dialog_cancel'),
      confirmButtonText: t('confirm_button_text'),
    })
    if (confirmed) {
      clearPlayHistory()
      toast(t('play_history_clear'))
    }
  }, [t])

  const handleRemove = useCallback((musicId: string) => {
    removePlayHistoryEntry(musicId)
  }, [])

  const handlePlayAll = useCallback(() => {
    if (!data.length) return
    const list = data.map(e => ({ listId: '' as const, musicInfo: e.musicInfo }))
    addTempPlayList(list)
    toast(t('play_history_play_all_tip', { count: String(data.length) }))
  }, [data, t])

  const handlePlay = useCallback((item: LX.Player.PlayHistoryEntry) => {
    addTempPlayList([{ listId: '', musicInfo: item.musicInfo }])
  }, [])

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  }), [])

  const renderItem = useCallback(({ item }: { item: LX.Player.PlayHistoryEntry }) => (
    <TouchableOpacity
      style={[styles.item, { borderBottomColor: theme['c-border-background'] }]}
      onPress={() => handlePlay(item)}
      onLongPress={() => handleRemove(item.musicId)}
    >
      <View style={styles.itemInfo}>
        <Text style={[styles.songName, { color: theme['c-font'] }]} numberOfLines={1}>
          {item.musicInfo.name}
        </Text>
        <Text style={[styles.singer, { color: theme['c-font-label'] }]} numberOfLines={1}>
          {item.musicInfo.singer}
        </Text>
      </View>
      <View style={styles.itemRight}>
        {(tab === 'most' || tab === 'top25_most') && (
          <Text style={[styles.playCount, { color: theme['c-primary-font'] }]}>
            {item.playCount}
          </Text>
        )}
        <Text style={[styles.time, { color: theme['c-font-label'] }]}>
          {formatRelativeTime(item.playedAt)}
        </Text>
      </View>
    </TouchableOpacity>
  ), [theme, tab, handlePlay, handleRemove])

  const keyExtractor = useCallback((item: LX.Player.PlayHistoryEntry) => item.musicId, [])

  return (
    <View style={styles.container}>
      <View style={[styles.tabs, { borderBottomColor: theme['c-border-background'] }]}>
        <TouchableOpacity
          style={[styles.tab, tab === 'recent' && { borderBottomColor: theme['c-primary-font'] }]}
          onPress={() => setTab('recent')}
        >
          <Text style={[styles.tabText, { color: tab === 'recent' ? theme['c-primary-font'] : theme['c-font-label'] }]}>
            {t('play_history_recent')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'most' && { borderBottomColor: theme['c-primary-font'] }]}
          onPress={() => setTab('most')}
        >
          <Text style={[styles.tabText, { color: tab === 'most' ? theme['c-primary-font'] : theme['c-font-label'] }]}>
            {t('play_history_most')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'top25_recent' && { borderBottomColor: theme['c-primary-font'] }]}
          onPress={() => setTab('top25_recent')}
        >
          <Text style={[styles.tabText, { color: tab === 'top25_recent' ? theme['c-primary-font'] : theme['c-font-label'] }]}>
            {t('smart_list_recent', { count: '25' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'top25_most' && { borderBottomColor: theme['c-primary-font'] }]}
          onPress={() => setTab('top25_most')}
        >
          <Text style={[styles.tabText, { color: tab === 'top25_most' ? theme['c-primary-font'] : theme['c-font-label'] }]}>
            {t('smart_list_most_played', { count: '25' })}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.toolbar, { borderBottomColor: theme['c-border-background'] }]}>
        {isSmartList && data.length > 0 && (
          <TouchableOpacity style={styles.toolbarBtn} onPress={handlePlayAll}>
            <Text style={[styles.toolbarText, { color: theme['c-primary-font'] }]}>{t('play_history_play_all')}</Text>
          </TouchableOpacity>
        )}
        <View style={styles.toolbarRight}>
          <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
            <Text style={[styles.clearText, { color: theme['c-primary-font'] }]}>{t('play_history_clear')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme['c-font-label'] }]}>{t('play_history_empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          style={styles.list}
        />
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
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  headerRight: {
    paddingRight: 12,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  toolbarText: {
    fontSize: 13,
  },
  toolbarRight: {
    marginLeft: 'auto',
  },
  clearButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearText: {
    fontSize: 12,
  },
  list: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: ITEM_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  itemRight: {
    alignItems: 'flex-end',
  },
  playCount: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  time: {
    fontSize: 11,
    marginTop: 2,
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
