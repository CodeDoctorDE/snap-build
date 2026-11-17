// -*- mode: javascript; js-indent-level: 2 -*-

import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import * as tools from './tools.js'

interface ImageInfo {
  'build-request-id'?: string
  'build-request-timestamp'?: string
  build_url?: string
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    p = os.homedir() + p.slice(1)
  }
  return p
}

interface SnapcraftBuilderOptions {
  projectRoot: string
  includeBuildInfo: boolean
  snapcraftChannel: string
  snapcraftArgs: string
  uaToken: string
}

export class SnapcraftBuilder {
  projectRoot: string
  includeBuildInfo: boolean
  snapcraftChannel: string
  snapcraftArgs: string
  uaToken: string

  constructor(options: SnapcraftBuilderOptions) {
    this.projectRoot = expandHome(options.projectRoot)
    this.includeBuildInfo = options.includeBuildInfo
    this.snapcraftChannel = options.snapcraftChannel
    this.snapcraftArgs = options.snapcraftArgs
    this.uaToken = options.uaToken
  }

  async build(): Promise<void> {
    core.startGroup('Installing Snapcraft plus dependencies')
    await tools.ensureSnapd()
    await tools.ensureLXD()
    await tools.ensureSnapcraft(this.snapcraftChannel)
    core.endGroup()

    const imageInfo: ImageInfo = {
      build_url: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    }
    // Copy and update environment to pass to snapcraft
    const env: {[key: string]: string} = {}
    Object.assign(env, process.env)
    env['SNAPCRAFT_BUILD_ENVIRONMENT'] = 'lxd'
    env['SNAPCRAFT_IMAGE_INFO'] = JSON.stringify(imageInfo)
    if (this.includeBuildInfo) {
      env['SNAPCRAFT_BUILD_INFO'] = '1'
    }

    const snapcraft = ['/snap/bin/snapcraft']
    if (this.snapcraftArgs) {
      snapcraft.push(...this.snapcraftArgs.split(/\s+/))
    }
    if (this.uaToken) {
      snapcraft.push('--ua-token', this.uaToken)
    }

    // Start a new session for the runner's LXD membership. Ubuntu 26.04's
    // sudo ignores -E, so preserve the environment variables Snapcraft needs.
    const preserveEnv = Object.keys(env)
      .filter(name => /^(?:snapcraft_|craft_|(?:https?|no)_proxy$)/i.test(name))
      .join(',')
    const user = os.userInfo().username
    await exec.exec(
      'sudo',
      ['-u', user, `--preserve-env=${preserveEnv}`, '--', ...snapcraft],
      {cwd: this.projectRoot, env}
    )
  }

  // This wrapper is for the benefit of the tests, due to the crazy
  // typing of fs.promises.readdir()
  async _readdir(dir: string): Promise<string[]> {
    return await fs.promises.readdir(dir)
  }

  async outputSnap(): Promise<string> {
    const files = await this._readdir(this.projectRoot)
    const snaps = files.filter(name => name.endsWith('.snap'))

    if (snaps.length === 0) {
      throw new Error('No snap files produced by build')
    }
    if (snaps.length > 1) {
      core.warning(`Multiple snaps found in ${this.projectRoot}`)
    }
    return path.join(this.projectRoot, snaps[0])
  }
}
