import { useImperativeHandle, forwardRef, useState, useCallback, useRef } from 'react'
import { View, TouchableOpacity, Animated, Dimensions } from 'react-native'
import Modal, { type ModalType } from './Modal'
import Text from './Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'

export interface ActionSheetOption {
  label: string
  value: string
  destructive?: boolean
}

export interface ActionSheetProps {
  title?: string
  options: ActionSheetOption[]
  onSelect: (option: ActionSheetOption) => void
  onCancel?: () => void
}

export interface ActionSheetType {
  show: () => void
  hide: () => void
}

const styles = createStyle({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 20,
  },
  titleContainer: {
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
  },
  title: {
    fontSize: 13,
    textAlign: 'center',
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
  },
  optionText: {
    fontSize: 17,
    textAlign: 'center',
  },
  cancelContainer: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cancelText: {
    fontSize: 17,
    textAlign: 'center',
    fontWeight: '600',
  },
})

export default forwardRef<ActionSheetType, ActionSheetProps>(({
  title,
  options,
  onSelect,
  onCancel,
}, ref) => {
  const theme = useTheme()
  const modalRef = useRef<ModalType>(null)
  const translateY = useRef(new Animated.Value(300)).current
  const [visible, setVisible] = useState(false)

  const show = useCallback(() => {
    setVisible(true)
    requestAnimationFrame(() => {
      modalRef.current?.setVisible(true)
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start()
    })
  }, [translateY])

  const hide = useCallback(() => {
    Animated.timing(translateY, {
      toValue: 300,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      modalRef.current?.setVisible(false)
      setVisible(false)
    })
  }, [translateY])

  useImperativeHandle(ref, () => ({
    show,
    hide,
  }), [show, hide])

  const handleSelect = useCallback((option: ActionSheetOption) => {
    hide()
    setTimeout(() => onSelect(option), 50)
  }, [hide, onSelect])

  const handleCancel = useCallback(() => {
    hide()
    onCancel?.()
  }, [hide, onCancel])

  if (!visible) return null

  return (
    <Modal ref={modalRef} onHide={handleCancel} bgColor="rgba(0,0,0,0.5)">
      <View style={{ flex: 1 }} />
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: theme['c-content-background'],
            transform: [{ translateY }],
          },
        ]}
      >
        {title && (
          <View style={[styles.titleContainer, { borderBottomColor: theme['c-border-background'] }]}>
            <Text style={styles.title} color={theme['c-font-label']}>
              {title}
            </Text>
          </View>
        )}
        {options.map((option, index) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.option,
              index < options.length - 1 && { borderBottomColor: theme['c-border-background'] },
            ]}
            onPress={() => handleSelect(option)}
            activeOpacity={0.7}
          >
            <Text
              style={styles.optionText}
              color={option.destructive ? '#FF3B30' : theme['c-button-font']}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.cancelContainer, { borderTopColor: theme['c-border-background'], borderTopWidth: 0.5 }]}
          onPress={handleCancel}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelText} color={theme['c-button-font']}>
            取消
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  )
})
