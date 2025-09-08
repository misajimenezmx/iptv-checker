import { FFprobeCommandBuilder } from './FFprobeCommandBuilder.js'
import { FFprobeOutputParser } from './FFprobeOutputParser.js'
import { FFprobeErrorParser } from './FFprobeErrorParser.js'
import { TESTING } from '../constants.js'
import { exec } from 'child_process'
import errors from '../errors.js'
import util from 'util'
import https from 'https'
import axios from 'axios'

const execAsync = util.promisify(exec)
const agent = new https.Agent({  
  rejectUnauthorized: false
})


export class FFprobe {
  constructor({ config, logger }) {
    this.commandBuilder = new FFprobeCommandBuilder({ config })
    this.outputParser = new FFprobeOutputParser()
    this.errorParser = new FFprobeErrorParser()
    this.config = config
    this.logger = logger
    this.hostWhitelist = new Set();
    this.hostBlacklist = new Set();
  }

  async check(item) {
    this.logger.debug('FFprobe.check')

    const command = this.commandBuilder.build(item)
    this.logger.debug(command)

    const timeout = item.timeout || this.config.timeout

    try {
      let output = {}
      const hostname = !!this.config.skipAlreadyTested ? (new URL(item.url)).hostname : null;
      if (TESTING) {
        const ffprobeOutput = (await import('../../tests/__mocks__/ffprobe.js')).default
        output = ffprobeOutput[item.url]
      } else {
        if(!!this.config.skipAlreadyTested && this.hostWhitelist.has(hostname)){
          return { ok: true, code: 'OK', metadata: null }
        }
        if(!!this.config.skipAlreadyTested && this.hostBlacklist.has(hostname)){
          return {
            ok: false,
            code: 'HTTP_REQUEST_TIMEOUT',
            message: errors['HTTP_REQUEST_TIMEOUT']
          }
        }
        if((await this.isStreamLive(item.url)) === true){
          output = await execAsync(command, { timeout })
        }else{
          if(!!this.config.skipAlreadyTested){
            this.logger.debug(`Blacklist added: ${hostname}`)
            this.hostBlacklist.add(hostname)
          }
          return {
            ok: false,
            code: 'HTTP_REQUEST_TIMEOUT',
            message: errors['HTTP_REQUEST_TIMEOUT']
          }
        }
      }

      this.logger.debug(output)

      const { stdout, stderr } = output

      if (!stdout || !isJSON(stdout) || !stderr) {
        this.logger.debug('FFMPEG_UNDEFINED')
        this.logger.debug(stdout)
        this.logger.debug(stderr)

        return {
          ok: false,
          code: 'FFMPEG_UNDEFINED',
          message: errors['FFMPEG_UNDEFINED']
        }
      }

      const metadata = this.outputParser.parse(stdout, stderr)
      if (!metadata.streams.length) {
        return {
          ok: false,
          code: 'FFMPEG_STREAMS_NOT_FOUND',
          message: errors['FFMPEG_STREAMS_NOT_FOUND']
        }
      }else if(!!this.config.skipAlreadyTested){
        this.hostWhitelist.add(hostname)
        this.logger.debug(`Whitelist added: ${hostname}`)
      }
      if (this.config.minHeight > 0) {
        const stream = metadata.streams.find(s => s['codec_type'] === 'video');
        let hasMinHeight = stream ? stream.height >= this.config.minHeight : false;
        this.logger.debug(`hasMinHeight: ${hasMinHeight}`)
        if(!stream || !hasMinHeight){
          return {
            ok: false,
            code: 'CONFIG_STREAM_HAS_NOT_MIN_HEIGHT_RES',
            message: errors['CONFIG_STREAM_HAS_NOT_MIN_HEIGHT_RES']
          }
        }
      }

      return { ok: true, code: 'OK', metadata }
    } catch (err) {
      this.logger.debug(err)

      const code = this.errorParser.parse(err.message, item)

      return {
        ok: false,
        code,
        message: errors[code]
      }
    }
  }

  async isStreamLive(url) {
    const timeout = (item.timeout || this.config.timeout)/5
    try {
      const opcs = {
        timeout: timeout < 500 ? 500 : timeout,
        httpsAgent: agent,
      };
      await axios.head(url, opcs);
      this.logger.debug(`isStreamLive: success`)
      return true;
    } catch (error) {
      this.logger.debug(`isStreamLive: fail`)
      return false;
    }
  }
}

function isJSON(str) {
  try {
    return !!JSON.parse(str)
  } catch {
    return false
  }
}

