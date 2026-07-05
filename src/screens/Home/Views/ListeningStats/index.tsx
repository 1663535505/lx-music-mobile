import { memo, useMemo } from 'react'
import { View, ScrollView, StyleSheet } from 'react-native'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { usePlayHistory } from '@/store/playHistory/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

interface ArtistStat {
  name: string
  playCount: number
  songCount: number
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const { mostPlayed, isLoaded } = usePlayHistory()

  const stats = useMemo(() => {
    if (!mostPlayed.length) return null

    const totalPlays = mostPlayed.reduce((sum, e) => sum + e.playCount, 0)
    const uniqueSongs = mostPlayed.length
    const artistMap = new Map<string, ArtistStat>()

    for (const entry of mostPlayed) {
      const singers = entry.musicInfo.singer.split('、').map(s => s.trim()).filter(Boolean)
      for (const singer of singers) {
        const existing = artistMap.get(singer)
        if (existing) {
          existing.playCount += entry.playCount
          existing.songCount++
        } else {
          artistMap.set(singer, { name: singer, playCount: entry.playCount, songCount: 1 })
        }
      }
    }

    const topArtists = Array.from(artistMap.values())
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 10)

    const topSongs = mostPlayed.slice(0, 10)
    const maxArtistPlays = topArtists[0]?.playCount ?? 1
    const maxSongPlays = topSongs[0]?.playCount ?? 1

    return { totalPlays, uniqueSongs, uniqueArtists: artistMap.size, topArtists, topSongs, maxArtistPlays, maxSongPlays }
  }, [mostPlayed])

  if (!isLoaded || !stats) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: theme['c-font-label'] }]}>{t('stats_empty')}</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.summaryRow}>
        <SummaryCard theme={theme} label={t('stats_total_plays')} value={String(stats.totalPlays)} />
        <SummaryCard theme={theme} label={t('stats_total_songs')} value={String(stats.uniqueSongs)} />
        <SummaryCard theme={theme} label={t('stats_unique_artists')} value={String(stats.uniqueArtists)} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme['c-font'] }]}>{t('stats_top_artists')}</Text>
        {stats.topArtists.map((artist, i) => (
          <BarRow
            key={artist.name}
            theme={theme}
            rank={i + 1}
            name={artist.name}
            subtitle={`${artist.songCount} songs`}
            count={artist.playCount}
            maxCount={stats.maxArtistPlays}
            label={t('stats_play_count', { count: String(artist.playCount) })}
          />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme['c-font'] }]}>{t('stats_top_songs')}</Text>
        {stats.topSongs.map((entry, i) => (
          <BarRow
            key={entry.musicId}
            theme={theme}
            rank={i + 1}
            name={entry.musicInfo.name}
            subtitle={entry.musicInfo.singer}
            count={entry.playCount}
            maxCount={stats.maxSongPlays}
            label={t('stats_play_count', { count: String(entry.playCount) })}
          />
        ))}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  )
})

const SummaryCard = ({ theme, label, value }: { theme: any; label: string; value: string }) => (
  <View style={[styles.card, { backgroundColor: theme['c-content-background'], borderColor: theme['c-border-background'] }]}>
    <Text style={[styles.cardValue, { color: theme['c-primary-font'] }]}>{value}</Text>
    <Text style={[styles.cardLabel, { color: theme['c-font-label'] }]}>{label}</Text>
  </View>
)

const BarRow = ({ theme, rank, name, subtitle, count, maxCount, label }: {
  theme: any; rank: number; name: string; subtitle: string; count: number; maxCount: number; label: string
}) => (
  <View style={[styles.barRow, { borderBottomColor: theme['c-border-background'] }]}>
    <Text style={[styles.rank, { color: theme['c-font-label'] }]}>{rank}</Text>
    <View style={styles.barInfo}>
      <Text style={[styles.barName, { color: theme['c-font'] }]} numberOfLines={1}>{name}</Text>
      <Text style={[styles.barSubtitle, { color: theme['c-font-label'] }]} numberOfLines={1}>{subtitle}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(5, (count / maxCount) * 100)}%`, backgroundColor: theme['c-primary-font'] }]} />
      </View>
    </View>
    <Text style={[styles.barCount, { color: theme['c-primary-font'] }]}>{label}</Text>
  </View>
)

const styles = createStyle({
  container: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  cardLabel: {
    fontSize: 11,
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: {
    width: 24,
    fontSize: 13,
    textAlign: 'center',
  },
  barInfo: {
    flex: 1,
    marginHorizontal: 8,
  },
  barName: {
    fontSize: 14,
  },
  barSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  barTrack: {
    height: 4,
    backgroundColor: 'rgba(128,128,128,0.15)',
    borderRadius: 2,
    marginTop: 4,
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  barCount: {
    fontSize: 12,
    minWidth: 50,
    textAlign: 'right',
  },
})
