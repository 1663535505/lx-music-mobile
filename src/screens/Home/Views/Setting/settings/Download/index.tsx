import { memo, useCallback, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { selectManagedFolder, writeFile, unlink } from '@/utils/fs'
import settingState from '@/store/setting/state'
import CheckBox from '@/components/common/CheckBox'
import { TRY_QUALITYS_LIST } from '@/core/music/utils'
import CheckBoxItem from '../../components/CheckBoxItem'
import Section from '../../components/Section'

const extractFolderName = (path: string): string => {
  if (path.startsWith('content://')) {
    // Extract folder name from SAF URI
    // e.g. content://com.android.providers.downloads.documents/tree/primary%3AMusic -> Music
    const decoded = decodeURIComponent(path)
    const lastSlash = decoded.lastIndexOf('/')
    if (lastSlash !== -1) {
      const name = decoded.substring(lastSlash + 1)
      // Remove any trailing path segments
      return name.split(':')[1] || name
    }
    return decoded
  }
  // Regular path: get last directory name
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

export default memo(() => {
  const t = useI18n()
  const isAutoSaveOnPlay = useSettingValue('download.isAutoSaveOnPlay')
  const isAutoDownloadList = useSettingValue('download.isAutoDownloadList')
  const wifiOnly = useSettingValue('download.wifiOnly')
  const isWriteTag = useSettingValue('download.isWriteTag')
  const maxRetries = useSettingValue('download.maxRetries')
  const savePath = useSettingValue('download.savePath')
  const downloadQuality = useSettingValue('download.quality')
  const [selecting, setSelecting] = useState(false)

  const qualityList = useMemo(() => {
    return ['' as const, ...[...TRY_QUALITYS_LIST, '128k'].reverse() as LX.Quality[]]
  }, [])

  const handleToggleAutoSave = useCallback((val: boolean) => {
    if (val && !settingState.setting['download.savePath']) {
      toast(t('setting_download_no_path'))
      return
    }
    updateSetting({ 'download.isAutoSaveOnPlay': val })
  }, [t])

  const handleToggleAutoList = useCallback((val: boolean) => {
    if (val && !settingState.setting['download.savePath']) {
      toast(t('setting_download_no_path'))
      return
    }
    updateSetting({ 'download.isAutoDownloadList': val })
  }, [t])

  const handleSelectPath = useCallback(async() => {
    if (selecting) return
    setSelecting(true)
    try {
      const result = await selectManagedFolder(true)
      if (result.isDirectory && result.path) {
        // Verify write access by writing a test file
        const testPath = `${result.path}/.write_test`
        try {
          await writeFile(testPath, 'test', 'utf8')
          await unlink(testPath)
        } catch {
          toast(t('setting_download_path_test_fail'))
          return
        }
        updateSetting({ 'download.savePath': result.path })
      }
    } catch (err) {
      console.log('select folder error:', err)
    } finally {
      setSelecting(false)
    }
  }, [selecting, t])

  const handleClearPath = useCallback(async() => {
    const confirm = await confirmDialog({
      message: t('setting_download_path_confirm_clear'),
      cancelButtonText: t('cancel_button_text_2'),
      confirmButtonText: t('confirm_button_text'),
      bgClose: false,
    })
    if (!confirm) return
    const updates: Partial<LX.AppSetting> = { 'download.savePath': '' }
    if (settingState.setting['download.isAutoSaveOnPlay']) updates['download.isAutoSaveOnPlay'] = false
    if (settingState.setting['download.isAutoDownloadList']) updates['download.isAutoDownloadList'] = false
    updateSetting(updates)
  }, [t])

  const folderName = savePath ? extractFolderName(savePath) : ''

  return (
    <Section title={t('setting_download')}>
      <View style={styles.pathContainer}>
        <Text style={styles.pathLabel}>{t('setting_download_path')}</Text>
        <View style={styles.pathRow}>
          <TouchableOpacity style={styles.pathButton} onPress={handleSelectPath}>
            {savePath ? (
              <>
                <Text style={styles.pathFolderName} numberOfLines={1}>{folderName}</Text>
                <Text style={styles.pathFullPath} numberOfLines={1}>{savePath}</Text>
              </>
            ) : (
              <Text style={styles.pathText}>{t('setting_download_path_not_set')}</Text>
            )}
          </TouchableOpacity>
          {savePath ? (
            <TouchableOpacity style={styles.clearButton} onPress={handleClearPath}>
              <Text style={styles.clearButtonText}>{t('setting_download_path_clear')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <CheckBoxItem
        check={isAutoSaveOnPlay}
        onChange={handleToggleAutoSave}
        label={t('setting_download_auto_save')}
        helpDesc={t('setting_download_auto_save_tip')}
      />
      <CheckBoxItem
        check={isAutoDownloadList}
        onChange={handleToggleAutoList}
        label={t('setting_download_auto_list')}
      />
      <CheckBoxItem
        check={wifiOnly}
        onChange={(val) => { updateSetting({ 'download.wifiOnly': val }) }}
        label={t('setting_download_wifi_only')}
      />
      <CheckBoxItem
        check={isWriteTag}
        onChange={(val) => { updateSetting({ 'download.isWriteTag': val }) }}
        label={t('setting_download_write_tag')}
        helpDesc={t('setting_download_write_tag_tip')}
      />
      <View style={styles.qualitySection}>
        <Text style={styles.pathLabel}>{t('download_setting_max_retries')}</Text>
        <Text style={styles.helpText}>{t('download_setting_max_retries_tip')}</Text>
        <View style={styles.qualityList}>
          {[0, 1, 2, 3, 5].map((n) => (
            <CheckBox
              marginRight={8}
              check={maxRetries === n}
              label={String(n)}
              onChange={() => { updateSetting({ 'download.maxRetries': n }) }}
              key={n}
              need
            />
          ))}
        </View>
      </View>
      <View style={styles.qualitySection}>
        <Text style={styles.pathLabel}>{t('setting_download_quality')}</Text>
        <View style={styles.qualityList}>
          {qualityList.map((q) => (
            <CheckBox
              marginRight={8}
              check={downloadQuality === q}
              label={q || t('setting_download_quality_same')}
              onChange={() => { updateSetting({ 'download.quality': q }) }}
              key={q || 'same'}
              need
            />
          ))}
        </View>
      </View>
    </Section>
  )
})

const styles = createStyle({
  pathContainer: {
    paddingHorizontal: 25,
    paddingVertical: 10,
  },
  pathLabel: {
    fontSize: 14,
    marginBottom: 6,
  },
  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pathButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pathText: {
    fontSize: 13,
    color: '#666',
  },
  pathFolderName: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  pathFullPath: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  clearButton: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f44336',
  },
  clearButtonText: {
    fontSize: 13,
    color: '#f44336',
  },
  qualitySection: {
    paddingHorizontal: 25,
    paddingVertical: 10,
  },
  qualityList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  helpText: {
    fontSize: 12,
    color: '#999',
    marginBottom: 6,
  },
})
