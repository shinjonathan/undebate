import Iota from '../../models/iota'
import serverEvents from './index'
import speech from '@google-cloud/speech'
import https from 'https'
import fs from 'fs'
import superagent from 'superagent'

function googleRecognize(audioBytes) {
  return new Promise(async (ok, ko) => {
    const client = new speech.SpeechClient()
    const audio = {
      content: audioBytes,
    }
    const config = {
      encoding: 'LINEAR16',
      languageCode: 'en-US',
      enableWordTimeOffsets: true,
    }
    const request = {
      audio: audio,
      config: config,
    }
    const [response] = await client.recognize(request)
    let transcribeData = response.results[0].alternatives[0]
    ok(transcribeData)
  })
}

async function notifyOfNewRecording(participantIota) {
  const transcriptionIota = {
    subject: 'Speech to text for: ' + participantIota.subject,
    description: 'Transcription for: ' + participantIota.description,
    component: {
      component: 'Transcription',
      transcriptions: [],
    },
  }
  for await (const speakingFile of participantIota.component.participant.speaking) {
    try {
      let convertedFile = speakingFile.replace('.mp4', '.wav')
      const resp = await superagent.get(convertedFile)
      let audioString = resp.body.toString('base64')
      const transcribeData = await googleRecognize(audioString)
      transcriptionIota.component.transcriptions.push(transcribeData)
    } catch (err) {
      logger.error('notify of new recording caught error', speakingFile, err)
    }
  }

  await Iota.insertOne(transcriptionIota)
}
serverEvents.on(serverEvents.eNames.ParticipantCreated, notifyOfNewRecording)
