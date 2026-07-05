import { useState, useCallback } from 'react'

import { View, TouchableOpacity } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { setLyricOffset } from '@/core/lyric'
import styles from './style'

const MIN_VALUE = -5000
const MAX_VALUE = 5000
const STEP = 50

export default () => {
  const theme = useTheme()
  const lyricOffset = useSettingValue('player.lyricOffset')
  const [sliderValue, setSliderValue] = useState(lyricOffset)
  const [isSliding, setSliding] = useState(false)
  const t = useI18n()

  const handleSlidingStart: SliderProps['onSlidingStart'] = () => {
    setSliding(true)
  }
  const handleValueChange: SliderProps['onValueChange'] = value => {
    setSliderValue(Math.round(value))
  }
  const handleSlidingComplete: SliderProps['onSlidingComplete'] = value => {
    setSliding(false)
    const offset = Math.round(value)
    if (lyricOffset === offset) return
    updateSetting({ 'player.lyricOffset': offset })
    setLyricOffset(offset)
  }

  const handleReset = useCallback(() => {
    if (lyricOffset === 0) return
    setSliderValue(0)
    updateSetting({ 'player.lyricOffset': 0 })
    setLyricOffset(0)
  }, [lyricOffset])

  const displayValue = isSliding ? sliderValue : lyricOffset
  const sign = displayValue > 0 ? '+' : ''

  return (
    <View style={styles.container}>
      <Text>{t('play_detail_setting_lrc_offset')}</Text>
      <View style={styles.content}>
        <Text style={styles.label} color={theme['c-font-label']}>{`${sign}${displayValue}ms`}</Text>
        <Slider
          minimumValue={MIN_VALUE}
          maximumValue={MAX_VALUE}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={STEP}
          value={lyricOffset}
        />
      </View>
      <View style={styles.content}>
        <TouchableOpacity onPress={() => {
          const newVal = Math.max(MIN_VALUE, (isSliding ? sliderValue : lyricOffset) - 500)
          setSliderValue(newVal)
          updateSetting({ 'player.lyricOffset': newVal })
          setLyricOffset(newVal)
        }}>
          <Text color={theme['c-primary-font']}>-500ms</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleReset} style={{ marginLeft: 16 }}>
          <Text color={theme['c-primary-font']}>{t('play_detail_setting_lrc_offset_reset')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          const newVal = Math.min(MAX_VALUE, (isSliding ? sliderValue : lyricOffset) + 500)
          setSliderValue(newVal)
          updateSetting({ 'player.lyricOffset': newVal })
          setLyricOffset(newVal)
        }} style={{ marginLeft: 16 }}>
          <Text color={theme['c-primary-font']}>+500ms</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
