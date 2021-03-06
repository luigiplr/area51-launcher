import fs from 'fs'
import path from 'path'
import md5File from 'md5-file'
import request from 'request'
import progress from 'request-progress'
import _ from 'lodash'
import async from 'async'
import mkdirp from 'mkdirp'
import sweetAlert from 'sweetalert'
import {
	EventEmitter
}
from 'events'

var prompted = false;
var totalFiles = 0;
var completedFiles = 1;

export default class Checker extends EventEmitter {
	constructor() {
		super()

		this.gameDir = path.join(__dirname, '../../', 'game')

		this.queue = async.queue((file, next) => this.checkFileSync(file)
			.then(next)
			.catch(err => {
				console.error(err)
				next()
			}))

		this.queue.drain = () => this.emit('done')

		this.checkRemote()
			.then(hashes => {
				if (hashes.length === 0)
					return this.emit('done')

				_.forEach(hashes, (hash, filePath) => {
					totalFiles++;
					this.queue.push({
						filePath, hash
					})
				})
			})
			.catch(console.error)
	}

	checkRemote() {
		return new Promise((resolve, reject) => request('https://andrew.im/area51/update.json', {
			json: true
		}, (error, response, body) => {
			if (!error && response.statusCode == 200)
				resolve(body.hashes)
			else
				reject('something went Very Wong:' + error + '\nCODE:' + response.statusCode + '\nBODY:' + JSON.stringify(body));
		}))
	}

	checkFileSync({
		filePath, hash
	}) {
		return new Promise((resolve, reject) => {
			return this.verifyFile(path.join(this.gameDir, filePath), hash)
				.then(verified => {
					if (verified) {
						totalFiles--
						console.info('Verified:', path.join(this.gameDir, filePath))
						return resolve()
					}
					this.askToUpdate().then(canupdate => {
						if (canupdate) {

							return this.downloadUpdatedFile(filePath, hash)
								.then(resolve)
								.catch(reject)
						} else return reject()
					})
				})
		})
	}

	verifyFile(filepath, hash) {
		return new Promise(resolve => {

			if (!fs.existsSync(path.dirname(filepath))){
				mkdirp.sync(path.dirname(filepath))
				return resolve(false)
			}

			md5File(filepath, (error, fileHash) => {
				if (error) return resolve(false)
				return resolve(hash === fileHash.toUpperCase())
			})
		})
	}

	downloadUpdatedFile(filePath, hash) {
		return new Promise((resolve, reject) => {
			progress(request(`http://codeusa.net/apps/poptartt/updates/${filePath}`), {
					throttle: 75,
					delay: 10
				})
				.on('error', err => {
					console.error(`Error downloading ${filePath}`, err)
					reject(err)
				})
				.on('progress', state => {
					this.emit('progress', {
						percent: state.percentage,
						total: totalFiles,
						completed: completedFiles
					})
				})
				.pipe(fs.createWriteStream(path.join(this.gameDir, filePath)))
				.on('finish', () => this.verifyFile(path.join(this.gameDir, filePath), hash)
					.then(verified => {
						if (!verified) return reject()
						completedFiles++
						console.info('Update successfully downloaded to:', path.join(this.gameDir, filePath))
						resolve()
					})
					.catch(reject))
		})
	}

	askToUpdate() {
		return new Promise(resolve => {
			if (prompted == 'yes')
				return resolve(true)
			if (prompted == 'noupdate')
				return resolve(false)
			sweetAlert({
				title: "A new game update is available",
				text: "Updating to the latest version is recommended for the best experience",
				type: "info",
				showCancelButton: true,
				confirmButtonColor: "#3C8C1F",
				confirmButtonText: "Update",
				cancelButtonText: "Don't update",
				closeOnConfirm: true,
				closeOnCancel: true
			}, (isConfirm) => {
				if (isConfirm) {
					console.info("Accepted update")
					prompted = 'yes'
					this.emit('updating')
					return resolve(true)
				} else {
					console.info("Declined update")
					prompted = 'noupdate'
					return resolve(false)
				}
			})
		})
	}
}