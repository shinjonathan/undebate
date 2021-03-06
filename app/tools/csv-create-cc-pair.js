#!/usr/bin/env node
'use strict;'

// this file makes it possible to create conversation viewer and candidate-recorder link pairs by combining information from a spreadsheet file, and an object template (below)
// the csv file lists the election Race names, and links to the viewer and recorder for that race - if they exist
// the program creates or updates records in the db, and generates a new spreadsheet -out.csv that includes the new links.  If a link was changes, a column shows that it was changed.
// take pair as a parameter which is a js file that describes the data and how to operate on it

const Iota = require('../models/iota')
const cloneDeep = require('lodash/cloneDeep')
const MongoModels = require('mongo-models')
const csv = require('csvtojson')
const ObjectsToCsv = require('objects-to-csv')
const mergeWith = require('lodash/mergeWith')

function waitForKeyTryAgain(toDo) {
  if (!waitForKeyTryAgain.started) waitForKeyTryAgain.started = true
  // we only need to call this once to set things up
  else return
  // thanks to https://stackoverflow.com/questions/5006821/nodejs-how-to-read-keystrokes-from-stdin for this code
  var stdin = process.stdin
  // without this, we would only get streams once enter is pressed
  stdin.setRawMode(true)
  // resume stdin in the parent process (node app won't quit all by itself
  // unless an error or process.exit() happens)
  stdin.resume()
  // i don't want binary, do you?
  stdin.setEncoding('utf8')
  // on any data into stdin
  stdin.on('data', function(key) {
    // ctrl-c ( end of text )
    if (key === '\u0003') {
      process.exit()
    }
    // write the key to stdout all normal like
    process.stdout.write(key)
    if (toDo) toDo()
  })
}

// Iota uses logger
const log4js = require('log4js')

if (!global.logger) {
  global.logger = log4js.getLogger('node')
  log4js.configure({
    appenders: { err: { type: 'stderr' } },
    categories: { default: { appenders: ['err'], level: 'DEBUG' } },
  })
}

function mergeWithVerbose(dst, src) {
  mergeWith(dst, src, (objValue, srcValue, key, object, source) => {
    if (typeof objValue !== 'object' && typeof srcValue !== 'object' && objValue !== srcValue) {
      console.info('key', key, 'changing', objValue, 'to', srcValue)
    }
    return undefined // do the default thing - were just here to print a message about it.
  })
}

function updateOrCreatePair(csvRowObj, template) {
  return new Promise(async (ok, ko) => {
    async function createNewRecorder(viewerObj) {
      try {
        var newRecorder = cloneDeep(template.getRecorder(csvRowObj))
        template.overWriteRecorderInfo.call(template, newRecorder, viewerObj, csvRowObj)
        var recorderObj = await Iota.create(newRecorder)
        console.info('created recorder', viewerObj.subject, viewerObj.path, recorderObj.path)
        return ok({ viewerObj, recorderObj })
      } catch (err) {
        console.error('createNewRecorder caught err', err)
        return err
      }
    }
    var viewers = await Iota.find({ path: template.viewerPath.call(template, csvRowObj) })
    if (viewers.length == 0) {
      // create the new race
      var newViewer = cloneDeep(template.getViewer(csvRowObj))
      template.overWriteViewerInfo.call(template, newViewer, csvRowObj)
      try {
        var viewerObj = await Iota.create(newViewer)
        createNewRecorder(viewerObj)
        return
      } catch (err) {
        console.error('create viewer caught error:', err)
        ko(err)
      }
    } else if (viewers.length) {
      // update the race
      var viewerObj = cloneDeep(viewers[0])
      mergeWithVerbose(viewerObj, template.getViewer(csvRowObj))
      template.overWriteViewerInfo.call(template, viewerObj, csvRowObj)
      await Iota.findOneAndReplace({ _id: viewerObj._id }, viewerObj)
      var recorders = await Iota.find({ path: template.recorderPath.call(template, csvRowObj) })
      if (recorders.length === 0) {
        // it didn't exist
        createNewRecorder(viewerObj)
        return
      } else {
        var newRecorder = cloneDeep(recorders[0])
        mergeWithVerbose(newRecorder, template.getRecorder(csvRowObj))
        template.overWriteRecorderInfo.call(template, newRecorder, viewerObj, csvRowObj)
        var recorderObj = await Iota.findOneAndReplace({ _id: newRecorder._id }, newRecorder)
        return ok({ viewerObj, recorderObj })
      }
    }
  })
}

// fetch args from command line
var argv = process.argv
var args = {}
for (let arg = 2; arg < argv.length; arg++) {
  switch (argv[arg]) {
    case 'pair':
    case 'src': // the csv file
    case 'db': // the mongo database URI
      args[argv[arg]] = argv[++arg]
      break
    default:
      console.error('ignoring unexpected argument:', argv[arg])
  }
}

if (args.src && args.db && args.pair) {
  const viewerRecorderPair = require(args.pair)
  csv()
    .fromFile(args.src)
    .then(async csvRowObjList => {
      await MongoModels.connect({ uri: args.db }, { useUnifiedTopology: true })
      while (MongoModels.toInit && MongoModels.toInit.length) {
        // any models that need to createIndexes will push their init function
        MongoModels.toInit.shift()()
      }
      async function doTheUpdate(i) {
        // need to make sure the preceeding update is done, before doing the next one - so don't do this in a forEach loop where they all get fired off in parallel
        const csvRowObj = csvRowObjList[i]
        var result = await updateOrCreatePair(csvRowObj, viewerRecorderPair)
        viewerRecorderPair.updateProperties.call(viewerRecorderPair, csvRowObj, result.viewerObj, result.recorderObj)
        if (++i < csvRowObjList.length) doTheUpdate(i)
        else writeCSVAndDisconnect()
      }
      async function writeCSVAndDisconnect() {
        MongoModels.disconnect()
        const csvOut = new ObjectsToCsv(csvRowObjList)
        async function writeItOut() {
          try {
            await csvOut.toDisk(args.src) // write over the source file so changes will come back in
            console.info('csv File updated', args.src)
            process.exit(0)
          } catch (error) {
            if (error.code === 'EBUSY') {
              // happens when excel has the file open
              console.info(`${error.path} busy, try again? ^C to exit`)
              waitForKeyTryAgain(writeItOut)
            } else {
              console.error('error trying to write csv file', error)
              process.exit()
            }
          }
        }
        writeItOut()
      }
      viewerRecorderPair.setup && viewerRecorderPair.setup(csvRowObjList)
      doTheUpdate(0)
    })
    .catch(err => {
      console.error('csv caught error', err)
    })
} else {
  console.error(
    'usage: csv-create-cc-pair src <csv file> db <database uri> pair <viewer-recorder-pair.js> Note: pair must be relative to path of this program'
  )
  process.exit()
}
