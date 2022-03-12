import fs from "fs"

import {
	MangaSearchResult,
	MangaChapterSearchResult,
	Manga,
	MangaImporterContract
} from "@/Protocols/MangaImporterProtocol"
import { MeusMangasSearchResult, RawChapter, RawChapterPicture } from "@/Protocols/MeusMangasProtocol"

import HttpService from "@/Services/HttpService"
import ParserService from "@/Services/ParserService"
import CrawlerService from "@/Services/CrawlerService"
import QueueService from "@/Services/QueueService"
import CompressionService from "@/Services/CompressionService"
import TempFolderService from "@/Services/TempFolderService"

import MapUtil from "@/Utils/MapUtil"
import FileUtil from "@/Utils/FileUtil"
import SanitizationUtil from "@/Utils/SanitizationUtil"

class MeusMangasImporterService implements MangaImporterContract {
	private readonly httpService: HttpService
	private readonly parserService = new ParserService()
	private readonly queueService = new QueueService({ concurrency: 7 })
	private readonly websiteBaseURL = "https://meusmangas.net"

	constructor () {
		this.httpService = new HttpService({
			baseURL: this.websiteBaseURL,
			withProxy: true
		})
	}

	async getManga (name: string): Promise<Manga> {
		const manga = await this.searchManga(name)

		const mangaChapters = await this.searchMangaChapters(manga.path)

		return {
			title: manga.title,
			chapters: mangaChapters
		}
	}

	private async searchManga (name: string): Promise<MangaSearchResult> {
		const json = await this.httpService.toJSON<Record<string, MeusMangasSearchResult>>(`wp-json/site/search/?keyword=${name}&nonce=e154db27c2`)

		const [manga] = Object.values(json)

		const mangaPath = manga.url.replace(this.websiteBaseURL, "")

		return {
			title: manga.title,
			path: mangaPath
		}
	}

	private async searchMangaChapters (mangaPath: string): Promise<MangaChapterSearchResult[]> {
		const rawChapters = await this.getRawChaptersByMangaPath(mangaPath)

		const mangaSlug = mangaPath.split("/").pop()

		const chapters: MangaChapterSearchResult[] = rawChapters.map(rawChapter => {
			const title = `Chapter ${rawChapter.no}`
			const no = rawChapter.no
			const createdAt = rawChapter.date

			return {
				createdAt,
				no,
				title,
				getPagesFile: async () => {
					const rawChapterPictures = await this.getRawChapterPictures(mangaSlug, no)

					const compressionService = new CompressionService()

					const pagesFileName = SanitizationUtil.sanitizeFilename(`${mangaSlug}-${no}.zip`)
					const pagesFilePath = TempFolderService.mountTempPath(pagesFileName)

					const pagesFileStream = fs.createWriteStream(pagesFilePath)

					compressionService.pipe(pagesFileStream)

					const httpService = new HttpService({})

					await Promise.all(
						rawChapterPictures.map(async rawChapterPicture => {
							const rawChapterPictureReadStream = await httpService.toReadStream(rawChapterPicture.url)

							const { filename } = FileUtil.parseFilePath(rawChapterPicture.url)

							compressionService.addFile({ data: rawChapterPictureReadStream, fileName: filename })
						})
					)

					await compressionService.compress()

					const pagesFile = await fs.promises.readFile(pagesFilePath)

					return pagesFile
				}
			}
		})

		return chapters
	}

	private async getRawChaptersByMangaPath (mangaPath: string): Promise<RawChapter[]> {
		const html = await this.httpService.toString(mangaPath)

		const $ = this.parserService.parseHTML(html)

		const [lastChaptersPageElement] = $("#chapter-list > ul > li:nth-child(9)").toArray()

		const lastChaptersPage = Number((lastChaptersPageElement?.children?.[0] as any)?.children?.[0]?.data)

		const rawChapters: RawChapter[] = []

		await MapUtil.iterate(lastChaptersPage, async (index) => (
			await this.queueService.enqueue(async () => {
				const page = index + 1

				const html = await this.httpService.toString(`${mangaPath}/page/${page}`)

				const $ = this.parserService.parseHTML(html)

				const chapterListElements = $("#chapter-list > div.list-load > ul > li > a").toArray()

				chapterListElements.map(chapterListElement => {
					const chapterTitleElement = CrawlerService.getElementByClassName(chapterListElement, "cap-text")
					const chapterDateElement = CrawlerService.getElementByClassName(chapterListElement, "chapter-date")

					const chapterNumber = parseInt((chapterTitleElement.lastChild as any).data)
					const chapterDate = (chapterDateElement.lastChild as any).data

					const chapterUrl = chapterListElement.attribs.href
					const chapterPath = chapterUrl.replace(this.websiteBaseURL, "")

					if (chapterNumber) {
						rawChapters.push({
							no: chapterNumber,
							date: chapterDate,
							path: chapterPath
						})
					}
				})
			})
		))

		return rawChapters
	}

	private async getRawChapterPictures (mangaSlug: string, chapterNo: number): Promise<RawChapterPicture[]> {
		let foundAllPictures = false
		let currentChapterPictureOrder = 1

		const rawChapterPictures: RawChapterPicture[] = []

		const cdnUrl = "https://img.meusmangas.net"
		const cdnHttpService = new HttpService({ baseURL: cdnUrl })

		while (!foundAllPictures) {
			const picturePath = `image/${mangaSlug}/${chapterNo}/${currentChapterPictureOrder}.jpg`

			const pictureExists = await cdnHttpService.exists(picturePath)

			if (pictureExists) {
				rawChapterPictures.push({
					url: `${cdnUrl}/${picturePath}`,
					order: currentChapterPictureOrder
				})

				currentChapterPictureOrder++
			} else {
				foundAllPictures = true
			}
		}

		return rawChapterPictures
	}
}

export default new MeusMangasImporterService()
