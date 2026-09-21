import { appDatabase } from './AppDatabaseInstance'
import { FrontendWorkshopImageHostingService } from '../services/FrontendWorkshopImageHostingService'
import { GeneratedImageAlbumService } from '../services/GeneratedImageAlbumService'
import { generatedImageToBlob } from '../services/GeneratedImageData'
import { IndexedDbGeneratedImageAlbumStorage } from '../storage/IndexedDbGeneratedImageAlbumStorage'

export const frontendWorkshopImageHostingService = new FrontendWorkshopImageHostingService()
export const generatedImageAlbumService = new GeneratedImageAlbumService(
  new IndexedDbGeneratedImageAlbumStorage(appDatabase),
  (image) => generatedImageToBlob(fetch, image),
)
