import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from 'react'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { View, TouchableOpacity } from 'react-native'
import Input, { type InputType } from '@/components/common/Input'
import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import {
  cancelTimeoutExit, getTimeoutExitTime, onTimeUpdate, startTimeoutExit, stopTimeoutExit, useTimeoutExitTimeInfo,
  startSongCountExit, stopSongCountExit, getSongCountRemaining, useSongCountInfo,
} from '@/core/player/timeoutExit'
import { useI18n } from '@/lang'
import CheckBox from './common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import settingState from '@/store/setting/state'

const MAX_MIN = 1440
const MAX_SONGS = 100
const rxp = /([1-9]\d*)/
const formatTime = (time: number) => {
  let h = Math.trunc(time / 3600)
  let hStr = h ? h.toString() + ':' : ''
  time = time % 3600
  const m = Math.trunc(time / 60).toString().padStart(2, '0')
  const s = Math.trunc(time % 60).toString().padStart(2, '0')
  return `${hStr}${m}:${s}`
}

type ExitMode = 'time' | 'song'

const Status = () => {
  const theme = useTheme()
  const t = useI18n()
  const exitTimeInfo = useTimeoutExitTimeInfo()
  const songRemaining = useSongCountInfo()
  const mode: ExitMode = songRemaining >= 0 ? 'song' : 'time'

  if (mode === 'song' && songRemaining >= 0) {
    return (
      <View style={styles.tip}>
        <Text>{t('timeout_exit_song_tip_on', { count: String(songRemaining) })}</Text>
      </View>
    )
  }

  return (
    <View style={styles.tip}>
      {
      exitTimeInfo.time < 0
        ? (
            <Text>{t('timeout_exit_tip_off')}</Text>
          )
        : (
            <Text>{t('timeout_exit_tip_on', { time: formatTime(exitTimeInfo.time) })}</Text>
          )
      }
      {exitTimeInfo.isPlayedStop ? <Text color={theme['c-font-label']} size={13}>{t('timeout_exit_btn_wait_tip')}</Text> : null}
    </View>
  )
}


interface InputRefType {
  setText: (text: string) => void
  getText: () => string
  focus: () => void
}
const TextInput = forwardRef<InputRefType, { placeholder: string }>(({ placeholder }, ref) => {
  const theme = useTheme()
  const [text, setText] = useState('')
  const inputRef = useRef<InputType>(null)

  useImperativeHandle(ref, () => ({
    getText() {
      return text.trim()
    },
    setText(text) {
      setText(text)
    },
    focus() {
      inputRef.current?.focus()
    },
  }))

  return (
    <Input
      ref={inputRef}
      placeholder={placeholder}
      value={text}
      onChangeText={setText}
      style={{ ...styles.input, backgroundColor: theme['c-primary-input-background'] }}
    />
  )
})


export const useTimeInfo = () => {
  const [exitTimeInfo, setExitTimeInfo] = useState({
    cancelText: '',
    confirmText: '',
    isPlayedStop: false,
    active: false,
  })
  const t = useI18n()

  useEffect(() => {
    let active: boolean | null = null
    const remove = onTimeUpdate((time, isPlayedStop) => {
      if (time < 0) {
        if (active) {
          setExitTimeInfo({
            cancelText: isPlayedStop ? t('timeout_exit_btn_wait_cancel') : '',
            confirmText: '',
            isPlayedStop,
            active: false,
          })
          active = false
        }
      } else {
        if (active !== true) {
          setExitTimeInfo({
            cancelText: t('timeout_exit_btn_cancel'),
            confirmText: t('timeout_exit_btn_update'),
            isPlayedStop,
            active: true,
          })
          active = true
        }
      }
    })

    return () => {
      remove()
    }
  }, [t])

  return exitTimeInfo
}

export interface TimeoutExitEditModalType {
  show: () => void
}
interface TimeoutExitEditModalProps {
  timeInfo: ReturnType<typeof useTimeInfo>
}

export default forwardRef<TimeoutExitEditModalType, TimeoutExitEditModalProps>(({ timeInfo }, ref) => {
  const alertRef = useRef<ConfirmAlertType>(null)
  const timeInputRef = useRef<InputRefType>(null)
  const songInputRef = useRef<InputRefType>(null)
  const [visible, setVisible] = useState(false)
  const [mode, setMode] = useState<ExitMode>('time')
  const t = useI18n()
  const theme = useTheme()
  const timeoutExitPlayed = useSettingValue('player.timeoutExitPlayed')
  const fadeOut = useSettingValue('player.timeoutExitFadeOut')
  const songRemaining = useSongCountInfo()

  const handleShow = () => {
    alertRef.current?.setVisible(true)
    requestAnimationFrame(() => {
      if (settingState.setting['player.timeoutExit']) timeInputRef.current?.setText(settingState.setting['player.timeoutExit'])
      const savedSongCount = settingState.setting['player.timeoutExitSongCount']
      if (savedSongCount > 0) songInputRef.current?.setText(String(savedSongCount))
    })
  }
  useImperativeHandle(ref, () => ({
    show() {
      if (visible) handleShow()
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow()
        })
      }
    },
  }))

  const handleCancel = () => {
    if (mode === 'song') {
      if (songRemaining >= 0) {
        stopSongCountExit()
        toast(t('timeout_exit_tip_cancel'))
      }
      return
    }
    if (timeInfo.isPlayedStop) {
      cancelTimeoutExit()
      return
    }
    if (!timeInfo.active) return
    stopTimeoutExit()
    toast(t('timeout_exit_tip_cancel'))
  }
  const handleConfirm = () => {
    if (mode === 'song') {
      let countStr = songInputRef.current?.getText() ?? ''
      if (rxp.test(countStr)) {
        countStr = RegExp.$1
        if (parseInt(countStr) > MAX_SONGS) {
          toast(t('timeout_exit_tip_max', { num: MAX_SONGS }))
          return
        }
      } else {
        if (countStr.length) toast(t('input_error'))
        return
      }
      const count = parseInt(countStr)
      stopTimeoutExit()
      startSongCountExit(count)
      toast(t('timeout_exit_song_tip_on', { count: String(count) }))
      updateSetting({ 'player.timeoutExitSongCount': count })
      alertRef.current?.setVisible(false)
      return
    }

    let timeStr = timeInputRef.current?.getText() ?? ''
    if (rxp.test(timeStr)) {
      timeStr = RegExp.$1
      if (parseInt(timeStr) > MAX_MIN) {
        toast(t('timeout_exit_tip_max', { num: MAX_MIN }))
        return
      }
    } else {
      if (timeStr.length) toast(t('input_error'))
      timeStr = ''
    }
    if (!timeStr) return
    const time = parseInt(timeStr)
    cancelTimeoutExit()
    stopSongCountExit()
    startTimeoutExit(time * 60)
    toast(t('timeout_exit_tip_on', { time: formatTime(getTimeoutExitTime()) }))
    updateSetting({ 'player.timeoutExit': String(time) })
    alertRef.current?.setVisible(false)
  }

  const isSongActive = songRemaining >= 0

  return (
    visible
      ? <ConfirmAlert
          ref={alertRef}
          cancelText={isSongActive || timeInfo.isPlayedStop ? (timeInfo.isPlayedStop ? t('timeout_exit_btn_wait_cancel') : t('timeout_exit_btn_cancel')) : timeInfo.active ? t('timeout_exit_btn_cancel') : ''}
          confirmText={isSongActive || timeInfo.active ? t('timeout_exit_btn_update') : ''}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        >
          <View style={styles.alertContent}>
            <Status />
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'time' && { borderBottomColor: theme['c-primary-font'] }]}
                onPress={() => setMode('time')}
              >
                <Text color={mode === 'time' ? theme['c-primary-font'] : theme['c-font-label']}>{t('timeout_exit_mode_time')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'song' && { borderBottomColor: theme['c-primary-font'] }]}
                onPress={() => setMode('song')}
              >
                <Text color={mode === 'song' ? theme['c-primary-font'] : theme['c-font-label']}>{t('timeout_exit_mode_song')}</Text>
              </TouchableOpacity>
            </View>
            {mode === 'time' ? (
              <>
                <View style={styles.inputContent}>
                  <TextInput ref={timeInputRef} placeholder={t('timeout_exit_input_tip')} />
                  <Text style={styles.inputLabel}>{t('timeout_exit_min')}</Text>
                </View>
                <View style={styles.checkbox}>
                  <CheckBox check={timeoutExitPlayed} label={t('timeout_exit_label_isPlayed')} onChange={(check) => { updateSetting({ 'player.timeoutExitPlayed': check }) }} />
                </View>
              </>
            ) : (
              <>
                <View style={styles.inputContent}>
                  <TextInput ref={songInputRef} placeholder={t('timeout_exit_song_count_tip')} />
                  <Text style={styles.inputLabel}>{t('timeout_exit_song_count')}</Text>
                </View>
                <View style={styles.checkbox}>
                  <CheckBox check={fadeOut} label={t('timeout_exit_fade_out')} onChange={(check) => { updateSetting({ 'player.timeoutExitFadeOut': check }) }} />
                </View>
              </>
            )}
          </View>
        </ConfirmAlert>
      : null
  )
})

const styles = createStyle({
  alertContent: {
    flexShrink: 1,
    flexDirection: 'column',
  },
  tip: {
    marginBottom: 8,
  },
  modeRow: {
    flexDirection: 'row',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  checkbox: {
    marginTop: 5,
  },
  inputContent: {
    marginTop: 8,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
  },
  inputLabel: {
    marginLeft: 8,
  },
})
