import { memo, useRef, useCallback } from 'react'
import { View } from 'react-native'
import Button from '@/components/common/Button'
import ActionSheet, { type ActionSheetType, type ActionSheetOption } from '@/components/common/ActionSheet'

import { createStyle } from '@/utils/tools'
import { pop } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import commonState from '@/store/common/state'
import Text from '@/components/common/Text'
import { handleCollect, handleDownloadAll, handlePlay } from './listAction'
import songlistState from '@/store/songlist/state'
import { useI18n } from '@/lang'
import { useListInfo } from './state'
// import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'

export interface ActionBarProps {
  onEnterMultiSelectMode?: () => void
}

export default memo(({ onEnterMultiSelectMode }: ActionBarProps) => {
  const theme = useTheme()
  const t = useI18n()
  const info = useListInfo()
  const actionSheetRef = useRef<ActionSheetType>(null)

  const back = () => {
    void pop(commonState.componentIds.songlistDetail!)
  }

  const handlePlayAll = () => {
    if (!songlistState.listDetailInfo.info.name) return
    void handlePlay(info.id, info.source, songlistState.listDetailInfo.list)
  }

  const handleCollection = () => {
    if (!songlistState.listDetailInfo.info.name) return
    void handleCollect(info.id, info.source, songlistState.listDetailInfo.info.name || info.name)
  }

  const handleDownload = useCallback(() => {
    if (!songlistState.listDetailInfo.info.name) return
    actionSheetRef.current?.show()
  }, [])

  const handleSelectOption = useCallback((option: ActionSheetOption) => {
    if (option.value === 'download_all') {
      void handleDownloadAll(info.id, info.source, songlistState.listDetailInfo.list)
    } else if (option.value === 'select_download') {
      onEnterMultiSelectMode?.()
    }
  }, [info.id, info.source, onEnterMultiSelectMode])

  const downloadOptions: ActionSheetOption[] = [
    { label: t('download_all'), value: 'download_all' },
    { label: t('select_download'), value: 'select_download' },
  ]

  return (
    <View style={styles.container}>
      <Button onPress={handleCollection} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('collect_songlist')}</Text>
      </Button>
      <Button onPress={handlePlayAll} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('play_all')}</Text>
      </Button>
      <Button onPress={handleDownload} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('setting_download_list')}</Text>
      </Button>
      <Button onPress={back} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('back')}</Text>
      </Button>
      <ActionSheet
        ref={actionSheetRef}
        options={downloadOptions}
        onSelect={handleSelectOption}
      />
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'row',
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
  },
  controlBtn: {
    flexGrow: 1,
    flexShrink: 1,
    width: '25%',
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 10,
    paddingRight: 10,
  },
  controlBtnText: {
    fontSize: 13,
    textAlign: 'center',
  },
})

