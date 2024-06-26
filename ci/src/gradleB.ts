/**
 * Gradle 项目相关方法
 */
import { resolve } from 'path'
import { readFile, writeFile, open } from 'fs/promises'
import { SpawnOptions } from 'child_process'
import { uploadFile } from '@/r2'
import { getFileSha1 } from '@/checksum'
import { BuildTask } from '@/types'
import { fileExists, spawnProcess } from '@/utils'
import { MultiStream } from '@/utils/MultiStream'

export async function setVersion(task: BuildTask) {
  // 去除 build.gradle(.kts) 版本信息
  await removeBuildVersion(task)
  // 设置 gradle.properties 版本
  await setupProperties(task)
  // 设置 settings.gradle 项目名称
  await setupSettings(task)
}

async function removeBuildVersion(task: BuildTask) {
  const buildGradle = task.project.buildOptions?.gradle?.kotlin ? 'build.gradle.kts' : 'build.gradle'
  const filePath = resolve(task.workspace, `./${buildGradle}`)
  const config = await readFile(filePath, 'utf8')
  const newConfig = config
    .replace('\r\n', '\n')
    .split('\n')
    .filter((cfgLine) => {
      return !cfgLine.startsWith('version')
    })
    .join('\n')

  await writeFile(filePath, newConfig, 'utf8')
}

async function setupProperties(task: BuildTask) {
  const filePath = resolve(task.workspace, './gradle.properties')
  const line = 'version = ' + task.finalVersion

  if (await fileExists(filePath)) {
    const config = await readFile(filePath, 'utf8')
    const newConfigs = config
      .replace('\r\n', '\n')
      .split('\n')
      .filter((cfgLine) => {
        return !cfgLine.startsWith('version')
      })

    newConfigs.push(line)
    const newConfig = newConfigs.join('\n')

    await writeFile(filePath, newConfig, 'utf8')
  } else {
    const newConfig = line + '\n'
    await writeFile(filePath, newConfig, 'utf8')
  }
}

async function setupSettings(task: BuildTask) {
  const filePath = resolve(task.workspace, './settings.gradle')
  const line = `rootProject.name = '${task.project.buildOptions.name}'`

  if (await fileExists(filePath)) {
    const config = await readFile(filePath, 'utf8')
    const newConfigs = config
      .replace('\r\n', '\n')
      .split('\n')
      .filter((cfgLine) => {
        return !cfgLine.startsWith('rootProject.name')
      })

    newConfigs.push(line)
    const newConfig = newConfigs.join('\n')

    await writeFile(filePath, newConfig, 'utf8')
  } else {
    const newConfig = line + '\n'
    await writeFile(filePath, newConfig, 'utf8')
  }
}

export async function build(task: BuildTask) {
  const logFilename = resolve(task.workspace, './gradle.log')
  const logFile = await open(logFilename, 'w')
  const logStream = logFile.createWriteStream()
  const logStdoutStream = new MultiStream([process.stdout, logStream])
  const logStderrStream = new MultiStream([process.stderr, logStream])

  const args = ['clean', 'build']
  if (task.project.buildOptions.gradle?.shadowJar) {
    args.push('shadowJar')
  }

  const gradleOptions: Partial<SpawnOptions> = {
    cwd: task.workspace
  }

  try {
    await spawnProcess('./gradlew', args, gradleOptions, logStdoutStream, logStderrStream)
  } catch (e) {
    logFile.close()
    task.logger.error('Gradle 构建失败', e)
    throw e
  }
}

export async function cleanup(task: BuildTask) {
  const path = `${task.project.author}/${task.project.repository}/${task.project.branch}`
  // 构建成功时上传构建结果
  if (task.success) {
    const suffix = task.project.buildOptions.gradle?.shadowJar ? '-all' : ''
    const targetFormat = task.project.buildOptions.gradle?.target ?? `{name}-{version}-${suffix}`
    const target = targetFormat.replace('{name}', task.project.buildOptions.name)
      .replace('{version}', task.finalVersion ?? '') + '.jar'
    const targetFinal = `${task.project.buildOptions.name}-${task.finalVersion}.jar`
    const targetPath = resolve(task.workspace, './build/libs', target)
    await uploadFile(`${path}/${targetFinal}`, targetPath)

    // 获取checksum
    task.target = targetFinal
    task.sha1 = await getFileSha1(targetPath)
  }

  // 上传日志
  const logPath = resolve(task.workspace, './gradle.log')
  if (await fileExists(logPath)) {
    await uploadFile(`${path}/Build-${task.version}.log`, logPath, 'text/plain')
  }
}

export default { setVersion, build, cleanup }
