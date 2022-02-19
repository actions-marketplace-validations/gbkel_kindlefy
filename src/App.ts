import SyncModule from "@/Modules/SyncModule"
import StoreModule from "@/Modules/StoreModule"
import ImportationModule from "@/Modules/ImportationModule"
import SetupInputModule from "@/Modules/SetupInputModule"
import ConversionModule from "@/Modules/ConversionModule"

import NotificationService from "@/Services/NotificationService"
import TempFolderService from "@/Services/TempFolderService"

class App {
	private readonly setupInputModule = new SetupInputModule()
	private readonly importationModule = new ImportationModule()
	private readonly conversionModule = new ConversionModule()

	async run (): Promise<void> {
		const config = await NotificationService.task("Fetch setup input", async (task) => {
			const result = await this.setupInputModule.fetch()

			task.setOutput(`Found kindle email (${result.kindle.email}), sources (${result.sources.length}), senders (${result.senders.length}), storages (${result.storages.length})`)

			return result
		})

		await TempFolderService.generate()

		const syncModule = new SyncModule(config.senders, config.kindle)
		const storeModule = new StoreModule(config.storages, config.sync)

		for (const source of config.sources) {
			await NotificationService.task(`Sync ${source.type} source (${source.name || source.url})`, async (task) => {
				task.setStatus("Importing source")

				const importedSource = await this.importationModule.import(source)

				task.setStatus("Converting source into documents")

				const documents = await this.conversionModule.convert(importedSource)

				for (const documentIndex in documents) {
					const document = documents[documentIndex]

					task.setStatus(`Syncing source documents: ${document.title} (${Number(documentIndex) + 1}/${documents.length})`)

					const isDocumentAlreadySync = await storeModule.isDocumentAlreadySync(document)

					if (!isDocumentAlreadySync) {
						await syncModule.sync(document)

						await storeModule.markDocumentSync(document)
					}
				}

				await storeModule.commitDocumentSyncChanges()

				task.setOutput(`Successfully sync ${documents.length} documents (${documents.map(document => document.title).join(", ")})`)
			})
		}

		await TempFolderService.clean()
	}
}

export default App
