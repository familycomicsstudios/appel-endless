export class LevelRenderer {
	constructor(screenWidth = 480, screenHeight = 360, thumbnailSize = [240, 180]) {
		this.screenWidth = screenWidth;
		this.screenHeight = screenHeight;
		this.thumbnailSize = thumbnailSize;

		this.canvas = document.createElement('canvas');
		this.canvas.width = screenWidth;
		this.canvas.height = screenHeight;
		this.ctx = this.canvas.getContext('2d');

		this.tileCache = new Map();
		this.tiles = [];
		this.background = null;
		this.MASK = [];
		this.needsHue = [];
		this.visibleTiles = [];
		this.backgroundVariants = new Map();
		this.assetsLoaded = false;

		console.debug("[LevelRenderer] Initialized with screen size", screenWidth, "x", screenHeight);
	}

	static getDataFromCode(code) {
		try {
			console.debug("[getDataFromCode] Parsing code:", code.substring(0, 20) + "...");
			const data = code.substring(7).split("Z");
			const LSX = data[0];
			const mapDataEnd = data.indexOf("");
			const MAP_data = data.slice(1, mapDataEnd);
			const remainingData = data.slice(mapDataEnd + 1);
			const mapRDataEnd = remainingData.indexOf("");
			const MAP_R_data = remainingData.slice(0, mapRDataEnd);

			if (mapDataEnd === -1 || mapRDataEnd === -1) {
				console.error("[getDataFromCode] Failed to find expected empty string separators in data.");
			}

			const MAP = [];
			for (let i = 0; i < MAP_data.length; i += 2) {
				const value = parseInt(parseFloat(MAP_data[i]));
				const count = parseInt(parseFloat(MAP_data[i + 1]));
				if (isNaN(value) || isNaN(count)) {
					console.warn(`[getDataFromCode] NaN detected in MAP_data at index ${i} or ${i + 1}`);
				}
				for (let j = 0; j < count; j++) MAP.push(value);
			}

			const MAP_R = [];
			for (let i = 0; i < MAP_R_data.length; i += 2) {
				let value = MAP_R_data[i];
				const count = parseInt(parseFloat(MAP_R_data[i + 1]));
				if (isNaN(count)) {
					console.warn(`[getDataFromCode] NaN count in MAP_R_data at index ${i + 1}`);
				}
				value = (value === 'Infinity' || value.includes('e')) ? 1 : parseInt(parseFloat(value));
				for (let j = 0; j < count; j++) MAP_R.push(value);
			}

			const finalData = remainingData.slice(mapRDataEnd + 1);

			if (!finalData || finalData.length < 2) {
				console.warn("[getDataFromCode] finalData is missing hue information or too short:", finalData);
			}

			return {
				map: MAP,
				rotations: MAP_R,
				size_x: parseInt(LSX),
				hue: finalData[finalData.length - 2],
				hue2: finalData[finalData.length - 1]
			};
		} catch (e) {
			console.error("[getDataFromCode] Exception caught:", e);
			throw e; // rethrow so caller knows
		}
	}

	async loadAssets(tilesFolder = "tiles", bgPath = "bg.svg") {
		try {
			console.debug("[loadAssets] Fetching MASK.txt");
			const maskResponse = await fetch('MASK.txt');
			if (!maskResponse.ok) throw new Error(`Failed to fetch MASK.txt, status: ${maskResponse.status}`);
			const maskText = await maskResponse.text();
			this.MASK = maskText.split('\n').map(line => line.replace('\r', ''));
			this.needsHue = this.MASK.map((mask, i) => mask[8] === 'h' ? i : -1).filter(i => i !== -1);
			this.visibleTiles = this.MASK.map((mask, i) => mask[5] === ' ' ? i : -1).filter(i => i !== -1);
			console.debug("[loadAssets] MASK.txt loaded, needsHue count:", this.needsHue.length);
		} catch (e) {
			console.warn("[loadAssets] Failed to load MASK.txt, using defaults. Error:", e);
			this.needsHue = Array.from({
				length: 86
			}, (_, i) => i).filter(i => i % 5 === 0);
			this.visibleTiles = Array.from({
				length: 86
			}, (_, i) => i);
		}

		const tilePromises = [];
		const maxTiles = 172;
		console.debug("[loadAssets] Loading tiles from folder:", tilesFolder);

		for (let i = 1; i <= maxTiles; i++) {
			tilePromises.push(new Promise(resolve => {
				const img = new Image();
				img.crossOrigin = "anonymous";
				img.onload = () => {
					resolve(img);
				};
				img.onerror = () => {
					console.error(`[loadAssets] Failed to load tile ${i}.svg`);
					resolve(null);
				};
				img.src = `${tilesFolder}/${i}.svg`;
			}));
		}

		const loadedTiles = await Promise.all(tilePromises);
		this.tiles = Array(maxTiles).fill(null).map((_, i) => loadedTiles[i]);
		console.debug("[loadAssets] Tiles loaded:", this.tiles.filter(t => t !== null).length, "/", maxTiles);

		try {
			console.debug("[loadAssets] Loading background image:", bgPath);
			const bgImg = new Image();
			bgImg.crossOrigin = "anonymous";
			await new Promise((resolve, reject) => {
				bgImg.onload = () => {
					console.debug("[loadAssets] Background image loaded.");
					resolve();
				};
				bgImg.onerror = () => {
					console.error("[loadAssets] Failed to load background image.");
					reject();
				};
				bgImg.src = bgPath;
			});
			this.background = bgImg;
		} catch {
			console.warn("[loadAssets] Using fallback background canvas.");
			const fallbackCanvas = document.createElement('canvas');
			fallbackCanvas.width = this.screenWidth;
			fallbackCanvas.height = this.screenHeight;
			const fallbackCtx = fallbackCanvas.getContext('2d');
			fallbackCtx.fillStyle = '#808080';
			fallbackCtx.fillRect(0, 0, fallbackCanvas.width, fallbackCanvas.height);
			this.background = fallbackCanvas;
		}

		this.assetsLoaded = true;
		console.debug("[loadAssets] Assets loading completed.");
	}

	rgbToHsv(r, g, b) {
		// no error logs needed here for speed, it's math
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b),
			min = Math.min(r, g, b),
			d = max - min;
		let h = 0;
		if (d !== 0) {
			if (max === r) h = ((g - b) / d) % 6;
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
		}
		h = ((h * 60) + 360) % 360;
		const s = max === 0 ? 0 : d / max;
		return [h, s, max];
	}

	hsvToRgb(h, s, v) {
		// no error logs here either, math-only
		h /= 60;
		const c = v * s;
		const x = c * (1 - Math.abs(h % 2 - 1));
		const m = v - c;
		const [r, g, b] =
		h < 1 ? [c, x, 0] :
			h < 2 ? [x, c, 0] :
			h < 3 ? [0, c, x] :
			h < 4 ? [0, x, c] :
			h < 5 ? [x, 0, c] : [c, 0, x];
		return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
	}

	applyColorEffect(source, hueShift) {

		try {
			const key = `${source.src || "bg"}_${hueShift}`;
			if (this.tileCache.has(key)) {
				return this.tileCache.get(key);
			}

			const canvas = document.createElement('canvas');
			canvas.width = source.width || source.naturalWidth;
			canvas.height = source.height || source.naturalHeight;
			const ctx = canvas.getContext('2d');
			ctx.drawImage(source, 0, 0);

			const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const data = imageData.data;

			for (let i = 0; i < data.length; i += 4) {
				if (hueShift >= 1000) {
					const gray = data[i];
					data[i] = gray;
					data[i + 1] = gray;
					data[i + 2] = gray;

				} else {
					const [h, s, v] = this.rgbToHsv(data[i], data[i + 1], data[i + 2]);
					const [r, g, b] = this.hsvToRgb((h + (hueShift % 200)) % 360, s, v);
					[data[i], data[i + 1], data[i + 2]] = [r, g, b];
				}
			}

			ctx.putImageData(imageData, 0, 0);
			this.tileCache.set(key, canvas);
			return canvas;
		} catch (e) {
			console.error("[applyColorEffect] Exception applying color effect:", e);
			return source;
		}
	}

	getTileWithEffects(tileIndex, hue, rotation) {
		try {
			const key = `${tileIndex}_${hue}_${rotation}`;
			if (this.tileCache.has(key)) {
				return this.tileCache.get(key);
			}

			let tile = this.tiles[tileIndex];
			if (!tile) {
				return null;
			}

			// Defensive: skip if tile size is zero
			const w = tile.width || tile.naturalWidth;
			const h = tile.height || tile.naturalHeight;
			if (!w || !h) {
				return null;
			}

			if (hue !== '0' && this.needsHue.includes(tileIndex % 86)) {
				tile = this.applyColorEffect(tile, hue);
			}

			if (rotation !== 1) {
				const canvas = document.createElement('canvas');
				const ctx = canvas.getContext('2d');
				canvas.width = w;
				canvas.height = h;
				ctx.translate(w / 2, h / 2);
				ctx.rotate((rotation - 1) * Math.PI / 2);
				ctx.drawImage(tile, -w / 2, -h / 2);
				tile = canvas;
			}

			this.tileCache.set(key, tile);
			return tile;
		} catch (e) {
			console.error("[getTileWithEffects] Exception caught:", e);
			return null;
		}
	}

	blitCenter(ctx, image, x, y) {
		if (!image) {
			console.warn("[blitCenter] Tried to draw null/undefined image at", x, y);
			return;
		}
		if ((image.width || image.naturalWidth) === 0 || (image.height || image.naturalHeight) === 0) {
			console.warn("[blitCenter] Tried to draw image with zero width or height at", x, y);
			return;
		}
		ctx.drawImage(image, x - (image.width || image.naturalWidth) / 2, y - (image.height || image.naturalHeight) / 2);
	}

	fixHue(hueShift) {
		let realhue;

		const hueShiftStr = String(hueShift);

		if (hueShift === 'Infinity') {
			realhue = 1000
		} else if (hueShiftStr === "" || hueShiftStr === " ") {
			realhue = 0
		} else if (hueShiftStr.includes("e") || hueShiftStr.includes("E")) {
			realhue = 1000;
			console.log("HRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarhHRWBWAHrwhwarh")
		} else if (hueShiftStr.includes("c") || hueShiftStr.includes("C")) {
			realhue = hueShiftStr.replace(/c/gi, "-");
			realhue = parseInt(realhue);
		} else {
			realhue = parseInt(hueShiftStr);
		}
		return realhue
	}

	async renderLevelImage(levelData) {
		try {
			if (!this.assetsLoaded) {
				console.debug("[renderLevelImage] Assets not loaded, loading now.");
				await this.loadAssets();
			}

			this.mapTiles = levelData.map;
			this.mapRotations = levelData.rotations;
			this.levelSizeX = levelData.size_x;
			const hue = this.fixHue(levelData.hue);
			const hue2 = this.fixHue(levelData.hue2);


			if (isNaN(hue) || isNaN(hue2)) {
				console.warn("[renderLevelImage] Parsed hue values are NaN:", hue, hue2);
			}

			const bgKey = `bg_${hue2}`;
			const background = this.backgroundVariants.has(bgKey) ?
				this.backgroundVariants.get(bgKey) :
				this.applyColorEffect(this.background, hue2);
			this.backgroundVariants.set(bgKey, background);

			this.ctx.drawImage(background, 0, 0);

			const startId = this.mapTiles.indexOf(76);
			if (startId === -1) {
				console.warn("[renderLevelImage] Start tile (76) not found in mapTiles.");
			}
			let startX = (startId % this.levelSizeX) - 4;
			let startY = Math.floor(startId / this.levelSizeX) - 2;
			if (startX < 0) startX = 0;
			if (startY < 0) startY = 0;

			for (let n = 0; n < 172; n += 86) {
				for (let rowIdx = 0; rowIdx < 7; rowIdx++) {
					const row = 8 - rowIdx - 1;
					for (let col = 0; col < 8; col++) {
						const mapX = (startX + col) % this.levelSizeX;
						const mapY = startY + row;
						const i = (mapY - 1) * this.levelSizeX + mapX;

						if (i < 0 || i >= this.mapTiles.length) {
							console.warn(`[renderLevelImage] Map index out of bounds: ${i}`);
							continue;
						}

						const tileIndex = this.mapTiles[i] - 1 + n;
						if (tileIndex < 0) {
							console.warn(`[renderLevelImage] Invalid tileIndex (negative): ${tileIndex}`);
							continue;
						}

						if (!this.visibleTiles.includes(tileIndex % 86)) continue;
						const rotation = this.mapRotations[i] % 4;
						const tile = this.getTileWithEffects(tileIndex, hue, rotation);
						if (tile) this.blitCenter(this.ctx, tile, col * 60 + 30, rowIdx * 60 - 30);
					}
				}
			}

			return this.canvas.toDataURL(); // Base64 PNG
		} catch (e) {
			console.error("[renderLevelImage] Exception caught:", e);
			throw e;
		}
	}
}