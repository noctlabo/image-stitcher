const { createApp, ref, computed, nextTick, watch } = Vue;

const App = {
  setup() {
    // 二次元配列で画像グループ（分割）を管理
    const imageGroups = ref([[]]);
    const selectedFormat = ref('png');
    const outputScale = ref(1); // 出力倍率 (1, 1.5, 2, 3)
    const currentTab = ref('vertical'); // 'vertical' | 'horizontal'
    const horizontalDirection = ref('rtl'); // 'ltr' (①▶②) | 'rtl' (②◀①)
    const decorationType = ref('none'); // 'none' | 'number' | 'triangle'
    const numberTarget = ref('all'); // 'all' | 'first'
    const numberSize = ref(11); // 5〜30px (デフォルト: 11)
    const numberingColor = ref('white'); // 'white' | 'black'
    const triangleColor = ref('#ff0000'); // 三角マークの色 (デフォルト赤)
    const triangleSize = ref(14); // 三角マークのサイズ (デフォルト: 14)
    const previewImageUrl = ref(null);
    const currentZoomScale = ref(1); // 現在の表示倍率 (1.0 = 100%)
    const fitZoomScale = ref(1); // 画面にフィットする倍率
    const naturalImageWidth = ref(0); // 画像の本来の幅
    const naturalImageHeight = ref(0); // 画像の本来の高さ
    const isDragging = ref(false);
    const isProcessing = ref(false);
    const fileInput = ref(null);
    const sortableLists = ref([]);

    let sortableInstances = [];
    let dsInstance = null;

    // SortableJSのMultiDragプラグインを有効化
    if (typeof Sortable !== 'undefined' && Sortable.MultiDrag) {
      Sortable.mount(new Sortable.MultiDrag());
    }

    // マウス/タッチリリース時に確実に選択枠要素をクリアするフェイルセーフ
    const cleanupSelectorArea = () => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          document.querySelectorAll('.ds-selector-area').forEach(el => el.remove());
        }, 50);
      });
    };
    window.addEventListener('mouseup', cleanupSelectorArea);
    window.addEventListener('touchend', cleanupSelectorArea);

    // DragSelectの初期化
    const initDragSelect = () => {
      if (dsInstance) {
        dsInstance.stop();
        dsInstance = null;
      }

      // 既存の選択枠DOM要素（.ds-selector-area）を強制削除して画面全体のハイライト残存を防ぐ
      document.querySelectorAll('.ds-selector-area').forEach(el => el.remove());

      const selectables = document.querySelectorAll('.ds-selectable');
      const areaEl = document.querySelector('.image-list-container') || document.body;

      if (selectables.length > 0) {
        dsInstance = new DragSelect({
          selectables: selectables,
          area: areaEl,
          selectedClass: 'selected',
          selectorClass: 'ds-selector-area',
        });
        // 選択操作終了（DS:end）時に選択枠要素をDOMから強制削除
        dsInstance.subscribe('DS:end', () => {
          cleanupSelectorArea();
        });
        // 初期化直後の不必要な全選択状態を防止するためにクリア
        dsInstance.clearSelection();
      }
    };

    // 全画像の合計枚数を算出
    const totalImagesCount = computed(() => {
      return imageGroups.value.reduce((acc, group) => acc + group.length, 0);
    });

    // 全画像枚数が0枚になった際にプレビュー結果を自動クリア
    watch(totalImagesCount, (newCount) => {
      if (newCount === 0) {
        stitchedImages.value = [];
      }
    });

    // SortableJSの初期化（複数グループ間での相互移動を許可）
    const initSortable = () => {
      // 既存インスタンスを破棄
      sortableInstances.forEach(instance => instance.destroy());
      sortableInstances = [];

      if (sortableLists.value && sortableLists.value.length > 0) {
        sortableLists.value.forEach((el) => {
          if (!el) return;
          const instance = new Sortable(el, {
            group: 'image-stitcher-group',
            animation: 150,
            handle: '.handle-item',
            filter: 'button', // ボタン要素でのドラッグを無効化
            preventOnFilter: false, // フィルタ対象要素のネイティブイベント（クリック等）をブロックしない
            multiDrag: true, // 複数ドラッグ有効化
            selectedClass: 'selected', // DragSelectと連携するクラス名
            fallbackTolerance: 3, // クリックや矩形選択と競合しにくくするための閾値
            onStart: () => {
              // ドラッグ開始時にDragSelectを一時停止し選択枠要素を消去
              if (dsInstance) {
                dsInstance.stop();
              }
              document.querySelectorAll('.ds-selector-area').forEach(el => el.remove());
            },
            onEnd: (evt) => {
              const fromGroupIndex = parseInt(evt.from.dataset.groupIndex, 10);
              const toGroupIndex = parseInt(evt.to.dataset.groupIndex, 10);

              if (!isNaN(fromGroupIndex) && !isNaN(toGroupIndex)) {
                // evt.oldIndiciesが存在し、要素がある場合は複数移動
                const isMulti = evt.oldIndicies && evt.oldIndicies.length > 0;

                let movedItems = [];
                if (isMulti) {
                  // 削除時にインデックスがずれないよう、降順にソートして処理する
                  const oldIndices = evt.oldIndicies.map(i => i.index).sort((a, b) => b - a);

                  // アイテムの抽出
                  oldIndices.forEach(idx => {
                    movedItems.push(imageGroups.value[fromGroupIndex][idx]);
                  });

                  // 元グループから削除
                  oldIndices.forEach(idx => {
                    imageGroups.value[fromGroupIndex].splice(idx, 1);
                  });

                  // 降順で抽出したため逆順になっているものを元に戻す
                  movedItems.reverse();
                } else {
                  // 単一移動
                  movedItems = imageGroups.value[fromGroupIndex].splice(evt.oldIndex, 1);
                }

                // 移動先のグループへ一括挿入
                imageGroups.value[toGroupIndex].splice(evt.newIndex, 0, ...movedItems);
              }

              // ドラッグ終了時にDragSelectを再開およびクリーンアップ
              if (dsInstance) {
                dsInstance.start();
                dsInstance.clearSelection();
              }
              cleanupSelectorArea();
            }
          });
          sortableInstances.push(instance);
        });
      }

      // SortableJSの初期化後にDragSelectも(再)初期化する
      initDragSelect();
    };

    // グループの追加
    const addGroup = async () => {
      imageGroups.value.push([]);
      await nextTick();
      initSortable();
    };

    // グループの削除
    const removeGroup = async (groupIndex) => {
      if (imageGroups.value.length <= 1) return;
      imageGroups.value.splice(groupIndex, 1);
      await nextTick();
      initSortable();
    };

    // ファイル選択ダイアログの起動
    const triggerFileInput = () => {
      if (fileInput.value) {
        fileInput.value.click();
      }
    };

    // ドラッグ＆ドロップ関連イベント処理
    const onDragOver = () => {
      isDragging.value = true;
    };

    const onDragLeave = () => {
      isDragging.value = false;
    };

    const onDrop = (e) => {
      isDragging.value = false;
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    };

    const onFileSelect = (e) => {
      const files = Array.from(e.target.files);
      processFiles(files);
      e.target.value = ''; // 選択リセット
    };

    // ファイル処理・読み込み・自動ソート（常に最初のグループに読み込み）
    const processFiles = async (files) => {
      const imageFiles = files.filter(file => file.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        alert('画像ファイルを選択してください。');
        return;
      }

      // 製作日（lastModified）順にソート（古い順）
      imageFiles.sort((a, b) => a.lastModified - b.lastModified);

      // グループが空の場合は初期作成
      if (imageGroups.value.length === 0) {
        imageGroups.value.push([]);
      }

      for (const file of imageFiles) {
        try {
          const src = await readFileAsDataURL(file);
          imageGroups.value[0].push({
            id: Date.now() + '-' + Math.random().toString(36).substring(2, 9),
            file: file,
            src: src,
            name: file.name,
            lastModified: file.lastModified
          });
        } catch (error) {
          alert(`ファイルの読み込みに失敗しました: ${file.name}`);
        }
      }

      await nextTick();
      initSortable();
    };

    // FileReaderのPromise化
    const readFileAsDataURL = (file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
      });
    };

    // 指定グループからの画像削除
    const removeImage = (groupIndex, imgIndex) => {
      imageGroups.value[groupIndex].splice(imgIndex, 1);
    };

    // 日時フォーマット処理
    const formatDate = (timestamp) => {
      const date = new Date(timestamp);
      return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    // モーダル表示時の画像表示計算サイズ
    const previewImageDisplayWidth = computed(() => {
      if (!naturalImageWidth.value || !currentZoomScale.value) return 0;
      return Math.round(naturalImageWidth.value * currentZoomScale.value);
    });

    // 拡大表示モーダル操作
    const openModal = async (src) => {
      previewImageUrl.value = src;
      try {
        const img = await loadImage(src);
        naturalImageWidth.value = img.naturalWidth || img.width;
        naturalImageHeight.value = img.naturalHeight || img.height;

        // ウィンドウサイズに合わせて初期フィット倍率を計算（パディング分を考慮）
        const padding = 64;
        const availableWidth = Math.max(100, window.innerWidth - padding);
        const availableHeight = Math.max(100, window.innerHeight - padding);

        const scaleX = availableWidth / naturalImageWidth.value;
        const scaleY = availableHeight / naturalImageHeight.value;

        // 画面に収まるスケール（最大でも1.0＝100%まで）
        fitZoomScale.value = Math.min(scaleX, scaleY, 1.0);
        currentZoomScale.value = fitZoomScale.value;
      } catch (e) {
        fitZoomScale.value = 1;
        currentZoomScale.value = 1;
      }
    };

    const closeModal = () => {
      previewImageUrl.value = null;
      currentZoomScale.value = 1;
      fitZoomScale.value = 1;
      naturalImageWidth.value = 0;
      naturalImageHeight.value = 0;
    };

    const zoomIn = () => {
      currentZoomScale.value = Math.min(5.0, Number((currentZoomScale.value + 0.15).toFixed(2)));
    };

    const zoomOut = () => {
      currentZoomScale.value = Math.max(0.1, Number((currentZoomScale.value - 0.15).toFixed(2)));
    };

    const resetZoom = () => {
      currentZoomScale.value = fitZoomScale.value;
    };

    // クリック時のトグル切り替え（フィット状態 ⇔ 原寸大(100%) または Fit倍率）
    const togglePreviewZoom = () => {
      if (Math.abs(currentZoomScale.value - fitZoomScale.value) < 0.05) {
        // 現在フィット状態に近い場合は100%（原寸大）に拡大
        currentZoomScale.value = 1.0;
      } else {
        // それ以外の場合はフィット状態に戻す
        resetZoom();
      }
    };

    // マウスホイールによる倍率制御
    const handleWheel = (e) => {
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    };

    // 画像読み込み用のPromise処理
    const loadImage = (src) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
      });
    };

    const stitchedImages = ref([]); // 結合結果プレビュー用配列

    // 画像結合処理（プレビュー用データの生成）
    const stitchImages = async () => {
      if (totalImagesCount.value === 0) {
        alert('結合する画像がありません。');
        return;
      }

      // 画像が含まれている有効なグループのみを抽出
      const validGroups = imageGroups.value.filter(group => group.length > 0);
      if (validGroups.length === 0) {
        alert('結合可能な画像が存在しません。');
        return;
      }

      isProcessing.value = true;
      stitchedImages.value = [];

      try {
        const extension = selectedFormat.value === 'jpg' ? 'jpg' : 'png';
        const mimeType = selectedFormat.value === 'jpg' ? 'image/jpeg' : 'image/png';
        const results = [];

        for (let i = 0; i < validGroups.length; i++) {
          const group = validGroups[i];
          const loadedImages = await Promise.all(
            group.map(item => loadImage(item.src))
          );

          let canvasWidth = 0;
          let canvasHeight = 0;
          let scaledItems = [];

          const scaleMultiplier = outputScale.value || 1;

          if (currentTab.value === 'vertical') {
            // 縦向き結合: 最大幅を基準に各画像の高さをスケーリングし倍率を適用
            const baseWidth = Math.max(...loadedImages.map(img => img.width));
            canvasWidth = baseWidth * scaleMultiplier;
            let currentY = 0;

            scaledItems = loadedImages.map(img => {
              const scale = canvasWidth / img.width;
              const scaledHeight = img.height * scale;
              const itemData = {
                img: img,
                x: 0,
                y: currentY,
                width: canvasWidth,
                height: scaledHeight
              };
              currentY += scaledHeight;
              return itemData;
            });
            canvasHeight = currentY;
          } else {
            // 横向き結合: 最大高さを基準に各画像の幅をスケーリングし倍率を適用
            const baseHeight = Math.max(...loadedImages.map(img => img.height));
            canvasHeight = baseHeight * scaleMultiplier;
            let totalWidth = 0;

            const tempItems = loadedImages.map(img => {
              const scale = canvasHeight / img.height;
              const scaledWidth = img.width * scale;
              const itemData = {
                img: img,
                width: scaledWidth,
                height: canvasHeight
              };
              totalWidth += scaledWidth;
              return itemData;
            });

            canvasWidth = totalWidth;

            // 結合順序に応じたX座標の算出
            if (horizontalDirection.value === 'ltr') {
              // ①▶②（左から右）: X=0から順に配置
              let currentX = 0;
              scaledItems = tempItems.map(item => {
                const itemData = {
                  ...item,
                  x: currentX,
                  y: 0
                };
                currentX += item.width;
                return itemData;
              });
            } else {
              // ②◀①（右から左）: 右端から順に左へ配置
              let currentX = canvasWidth;
              scaledItems = tempItems.map(item => {
                currentX -= item.width;
                return {
                  ...item,
                  x: currentX,
                  y: 0
                };
              });
            }
          }

          // Canvasの生成
          const canvas = document.createElement('canvas');
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          const ctx = canvas.getContext('2d');

          // 画質向上設定（補間アルゴリズムの最適化）
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // JPGの場合のみ背景を白に設定
          if (selectedFormat.value === 'jpg') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          // 画像の描画
          scaledItems.forEach(item => {
            ctx.drawImage(item.img, item.x, item.y, item.width, item.height);
          });

          // 横向き結合時の装飾描画処理
          if (currentTab.value === 'horizontal' && decorationType.value !== 'none') {
            scaledItems.forEach((item, index) => {
              // 「番号を振る」が選択されている場合
              if (decorationType.value === 'number') {
                if (numberTarget.value === 'first' && index !== 0) {
                  return; // ①番のみ設定時に2枚目以降をスキップ
                }

                const numberText = (index + 1).toString();
                const fontSize = Math.max(5, Math.min(30, numberSize.value || 11)) * scaleMultiplier;
                const radius = Math.max(8 * scaleMultiplier, Math.floor(fontSize * 0.9));
                const margin = Math.max(4 * scaleMultiplier, Math.floor(radius * 0.6));

                let circleX = 0;
                let circleY = item.y + margin + radius;

                if (horizontalDirection.value === 'ltr') {
                  // 左から右: 各画像の「左上」
                  circleX = item.x + margin + radius;
                } else {
                  // 右から左: 各画像の「右上」
                  circleX = item.x + item.width - margin - radius;
                }

                ctx.save();
                ctx.beginPath();
                ctx.arc(circleX, circleY, radius, 0, Math.PI * 2, false);
                ctx.fillStyle = numberingColor.value === 'white' ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.75)';
                ctx.fill();

                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = numberingColor.value === 'white' ? '#FFFFFF' : '#000000';
                ctx.fillText(numberText, circleX, circleY);
                ctx.restore();
              }

              // 「三角マークをつける」が選択されている場合（最初の画像1ヵ所のみに描画）
              if (decorationType.value === 'triangle') {
                if (index !== 0) return; // 最初の画像以外はスキップ

                const size = Math.max(5, triangleSize.value || 14) * scaleMultiplier;

                ctx.save();
                ctx.beginPath();

                if (horizontalDirection.value === 'ltr') {
                  // 左から右: 最初の画像の「左上」の角に三角形を描画
                  ctx.moveTo(item.x, item.y);
                  ctx.lineTo(item.x + size, item.y);
                  ctx.lineTo(item.x, item.y + size);
                } else {
                  // 右から左: 最初の画像の「右上」の角に三角形を描画
                  ctx.moveTo(item.x + item.width, item.y);
                  ctx.lineTo(item.x + item.width - size, item.y);
                  ctx.lineTo(item.x + item.width, item.y + size);
                }

                ctx.closePath();
                ctx.fillStyle = triangleColor.value || '#ff0000';
                ctx.fill();
                ctx.restore();
              }
            });
          }

          // 最高品質（1.0）でDataURLを生成しBase64データを取得
          const dataUrl = canvas.toDataURL(mimeType, 1.0);
          const base64Data = dataUrl.replace(/^data:image\/(png|jpeg);base64,/, '');

          results.push({
            dataUrl: dataUrl,
            base64Data: base64Data,
            extension: extension,
            mimeType: mimeType,
            fileName: `stitched-image-${i + 1}.${extension}`
          });
        }

        stitchedImages.value = results;
      } catch (error) {
        console.error(error);
        alert('画像の結合処理中にエラーが発生しました。');
      } finally {
        isProcessing.value = false;
      }
    };

    // 単一完成画像のダウンロード
    const downloadSingleImage = (item) => {
      const link = document.createElement('a');
      link.download = item.fileName;
      link.href = item.dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    // 全完成画像の一括ZIPダウンロード
    const downloadAllZip = async () => {
      if (stitchedImages.value.length === 0) return;

      isProcessing.value = true;
      try {
        const zip = new JSZip();
        stitchedImages.value.forEach(item => {
          zip.file(item.fileName, item.base64Data, { base64: true });
        });

        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `stitched-images-${Date.now()}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      } catch (error) {
        console.error(error);
        alert('ZIPファイルの作成中にエラーが発生しました。');
      } finally {
        isProcessing.value = false;
      }
    };

    return {
      imageGroups,
      totalImagesCount,
      selectedFormat,
      outputScale,
      currentTab,
      horizontalDirection,
      decorationType,
      numberTarget,
      numberSize,
      numberingColor,
      triangleColor,
      triangleSize,
      previewImageUrl,
      currentZoomScale,
      fitZoomScale,
      previewImageDisplayWidth,
      isDragging,
      isProcessing,
      fileInput,
      sortableLists,
      stitchedImages,
      addGroup,
      removeGroup,
      triggerFileInput,
      onDragOver,
      onDragLeave,
      onDrop,
      onFileSelect,
      removeImage,
      formatDate,
      openModal,
      closeModal,
      zoomIn,
      zoomOut,
      resetZoom,
      togglePreviewZoom,
      handleWheel,
      stitchImages,
      downloadSingleImage,
      downloadAllZip
    };
  }
};

createApp(App).mount('#app');
