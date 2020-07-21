import React, { useState, useEffect } from 'react'
import cx from 'classnames'
import { createUseStyles } from 'react-jss'

function getSeconds(wordTimeObj) {
  return parseFloat(wordTimeObj.seconds + '.' + wordTimeObj.nanos)
}

const windowSeconds = 0

function withinTime(wordObj, currentTime) {
  let startTime = getSeconds(wordObj.startTime)
  let endTime = getSeconds(wordObj.endTime)
  return currentTime >= startTime - windowSeconds && currentTime <= endTime + windowSeconds
}

const Transcription = ({ transcript, element }) => {
  const classes = useStyles()
  const { transcription } = classes
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    var timer
    const onPlay = e => {
      if (!timer) timer = setInterval(() => setCurrentTime(element.currentTime), 100) // in case it gets called more than once don't set multiple timers
      setCurrentTime(element.currentTime)
    }
    element && element.addEventListener('play', onPlay)
    if (element && element.currentTime > 0) {
      //it's already started playing when this got called
      onPlay({})
    }
    return () => {
      clearInterval(timer)
      element.removeEventListener('play', onPlay)
    }
  }, [transcript, element])

  return (
    <div className={transcription}>
      {transcript &&
        transcript.words &&
        transcript.words.map(wordObj => (
          <div className={cx(classes.word, withinTime(wordObj, currentTime) && classes.litWord)}>{wordObj.word}</div>
        ))}
    </div>
  )
}

export default Transcription

const useStyles = createUseStyles({
  transcription: {
    fontSize: '1.75rem',
  },
  word: {
    color: '#333333',
    padding: '0.1em',
    fontWeight: 'normal',
    display: 'inline-block',
  },
  litWord: {
    backgroundColor: 'yellow',
    color: 'black',
  },
})
