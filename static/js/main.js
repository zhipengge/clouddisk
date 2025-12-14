let fileTree = [];
let currentSelectedPath = '';
let currentSelectedItem = null;
let draggedItem = null;
let contextMenuTarget = null;

// 操作历史记录（最多5步）
let operationHistory = [];
const MAX_HISTORY = 5;

// 搜索相关
let searchTimeout = null;
let expandedPaths = new Set(); // 记录展开的文件夹路径

// 加载文件树
async function loadTree() {
    const browser = document.getElementById('fileBrowser');
    browser.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

    try {
        const response = await fetch('/api/tree');
        const data = await response.json();

        if (data.success) {
            fileTree = data.tree;
            renderTree(fileTree);
            updateFolderSelects();
            loadStats();
            loadServerInfo();
            
            // 恢复展开状态
            restoreExpandedState();
            
            return Promise.resolve();
        } else {
            browser.innerHTML = `<div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <div class="empty-text">加载失败: ${data.error}</div>
            </div>`;
            return Promise.reject(new Error(data.error));
        }
    } catch (error) {
        browser.innerHTML = `<div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <div class="empty-text">加载失败: ${error.message}</div>
        </div>`;
        return Promise.reject(error);
    }
}

// 渲染文件树
function renderTree(tree, parentElement = null, level = 0) {
    const browser = document.getElementById('fileBrowser');
    if (!parentElement) {
        browser.innerHTML = '';
        
        // 重新创建根目录拖放区域
        const rootDropZone = document.createElement('div');
        rootDropZone.id = 'rootDropZone';
        rootDropZone.className = 'drop-zone';
        rootDropZone.style.display = 'none';
        rootDropZone.textContent = '📁 拖放到此处移动到根目录';
        rootDropZone.addEventListener('dragover', handleDragOver);
        rootDropZone.addEventListener('drop', handleDrop);
        rootDropZone.addEventListener('dragleave', handleDragLeave);
        browser.appendChild(rootDropZone);
        
        if (tree.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.innerHTML = `
                <div class="empty-icon">📂</div>
                <div class="empty-text">暂无文件，上传一些文件开始使用吧！</div>
            `;
            browser.appendChild(emptyState);
            return;
        }
    }

    tree.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tree-item';
        itemDiv.dataset.path = item.path;
        itemDiv.dataset.isDir = item.is_dir;
        if (item.is_trash) {
            itemDiv.dataset.isTrash = 'true';
            itemDiv.dataset.undoId = item.undo_id || '';
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'tree-item-content draggable';
        contentDiv.draggable = true;
        if (item.path === currentSelectedPath) {
            contentDiv.classList.add('selected');
        }
        
        // 添加拖拽事件
        contentDiv.addEventListener('dragstart', handleDragStart);
        contentDiv.addEventListener('dragend', handleDragEnd);
        
        // 添加右键菜单事件
        contentDiv.addEventListener('contextmenu', handleContextMenu);
        
        // 如果是文件夹，添加拖放目标事件
        if (item.is_dir) {
            contentDiv.addEventListener('dragover', handleDragOver);
            contentDiv.addEventListener('drop', handleDrop);
            contentDiv.addEventListener('dragleave', handleDragLeave);
        }

        let html = '';
        
        if (item.is_dir) {
            html += `<span class="tree-toggle collapsed" onclick="toggleFolder(event, this)"></span>`;
            html += `<span class="tree-icon">📁</span>`;
        } else {
            html += `<span class="tree-toggle" style="visibility: hidden;"></span>`;
            // 如果是图片文件，显示缩略图
            if (item.type === 'image') {
                const imgPath = encodeURIComponent(item.path);
                html += `<span class="tree-icon tree-thumbnail"><img src="/api/preview?path=${imgPath}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.onerror=null; this.style.display='none'; this.parentElement.innerHTML='🖼️';"></span>`;
            } else {
                const icon = getFileIcon(item.type, item.ext);
                html += `<span class="tree-icon">${icon}</span>`;
            }
        }

        if (item.is_dir) {
            // 文件夹名称点击时展开/收起
            html += `<span class="tree-name" onclick="handleFolderNameClick(event, '${escapeHtml(item.path)}', ${item.is_dir})" ondragstart="event.stopPropagation()">${escapeHtml(item.name)}</span>`;
        } else {
            // 文件名称点击时选择
            html += `<span class="tree-name" onclick="selectItem('${escapeHtml(item.path)}', ${item.is_dir}, event)" ondragstart="event.stopPropagation()">${escapeHtml(item.name)}</span>`;
        }
        html += `<span class="tree-size">${item.size_human}</span>`;
        html += `<span class="tree-date">${item.modified}</span>`;
        
        html += `<div class="tree-actions">`;
        if (item.is_trash) {
            // 回收站中的文件：显示恢复和永久删除
            html += `<button class="btn btn-success btn-icon" onclick="restoreItem('${escapeHtml(item.undo_id)}')">恢复</button>`;
            html += `<button class="btn btn-danger btn-icon" onclick="permanentDeleteItem('${escapeHtml(item.undo_id)}')">永久删除</button>`;
        } else {
            // 普通文件：显示下载、预览、移动、删除
            if (!item.is_dir) {
                html += `<button class="btn btn-success btn-icon" onclick="downloadFile('${escapeHtml(item.path)}')">下载</button>`;
                html += `<button class="btn btn-icon" onclick="previewFile('${escapeHtml(item.path)}')">预览</button>`;
            }
            html += `<button class="btn btn-icon" onclick="showMoveModal('${escapeHtml(item.path)}')">移动</button>`;
            html += `<button class="btn btn-danger btn-icon" onclick="deleteItem('${escapeHtml(item.path)}', ${item.is_dir})">删除</button>`;
        }
        html += `</div>`;

        contentDiv.innerHTML = html;
        
        // 如果是图片文件，确保图片加载完成后显示
        if (!item.is_dir && item.type === 'image') {
            const img = contentDiv.querySelector('.tree-thumbnail img');
            if (img) {
                // 如果图片已经加载完成，直接显示
                if (img.complete && img.naturalHeight !== 0) {
                    img.classList.add('loaded');
                } else {
                    img.addEventListener('load', function() {
                        this.classList.add('loaded');
                    });
                    img.addEventListener('error', function() {
                        this.style.display = 'none';
                        this.parentElement.innerHTML = '🖼️';
                    });
                }
            }
        }
        
        // 在设置innerHTML后重新添加拖拽事件（因为innerHTML会清除事件监听器）
        contentDiv.draggable = true;
        contentDiv.addEventListener('dragstart', handleDragStart);
        contentDiv.addEventListener('dragend', handleDragEnd);
        
        // 如果是文件夹，添加拖放目标事件
        if (item.is_dir) {
            contentDiv.addEventListener('dragover', handleDragOver);
            contentDiv.addEventListener('drop', handleDrop);
            contentDiv.addEventListener('dragleave', handleDragLeave);
        }
        
        itemDiv.appendChild(contentDiv);

        if (item.is_dir && item.children && item.children.length > 0) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'tree-children';
            itemDiv.appendChild(childrenDiv);
            renderTree(item.children, childrenDiv, level + 1);
        }

        if (parentElement) {
            parentElement.appendChild(itemDiv);
        } else {
            browser.appendChild(itemDiv);
        }
    });
    
    // 为根目录添加拖放区域
    if (!parentElement) {
        const rootDropZone = document.getElementById('rootDropZone');
        if (rootDropZone && tree.length > 0) {
            rootDropZone.style.display = 'block';
            rootDropZone.addEventListener('dragover', handleDragOver);
            rootDropZone.addEventListener('drop', handleDrop);
            rootDropZone.addEventListener('dragleave', handleDragLeave);
        }
    }
}

// 获取文件图标
function getFileIcon(type, ext) {
    const icons = {
        'image': '🖼️',
        'text': '📄',
        'pdf': '📕',
        'video': '🎬',
        'audio': '🎵',
        'other': '📎'
    };
    return icons[type] || '📎';
}

// 切换文件夹展开/折叠
function toggleFolder(event, toggle) {
    event.stopPropagation();
    const item = toggle.closest('.tree-item');
    const children = item.querySelector('.tree-children');
    
    if (children) {
        if (toggle.classList.contains('collapsed')) {
            toggle.classList.remove('collapsed');
            toggle.classList.add('expanded');
            children.classList.add('expanded');
        } else {
            toggle.classList.remove('expanded');
            toggle.classList.add('collapsed');
            children.classList.remove('expanded');
        }
    }
}

// 处理文件夹名称点击
function handleFolderNameClick(event, path, isDir) {
    event.stopPropagation();
    const itemDiv = event.target.closest('.tree-item');
    if (!itemDiv) return;
    
    const toggle = itemDiv.querySelector('.tree-toggle');
    if (toggle) {
        // 触发展开/收起
        toggleFolder(event, toggle);
    }
    
    // 同时选中该文件夹
    selectItem(path, isDir, event);
}

// 选择项目
function selectItem(path, isDir, event) {
    currentSelectedPath = path;
    currentSelectedItem = { path, isDir };
    
    // 更新选中状态
    document.querySelectorAll('.tree-item-content').forEach(el => {
        el.classList.remove('selected');
    });
    if (event) {
        event.target.closest('.tree-item-content').classList.add('selected');
    }

    // 如果是文件夹，显示当前文件夹信息
    if (isDir) {
        document.getElementById('currentFolder').style.display = 'block';
        document.getElementById('currentFolderPath').textContent = '/' + path;
    } else {
        document.getElementById('currentFolder').style.display = 'none';
    }
}

// 更新文件夹选择器
function updateFolderSelects() {
    const selects = ['uploadFolderSelect', 'createFolderSelect', 'createFileFolderSelect', 'moveTargetSelect'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">根目录</option>';
            addFolderOptions(fileTree, select, '');
            if (currentValue) {
                select.value = currentValue;
            }
        }
    });
}

// 添加文件夹选项
function addFolderOptions(tree, select, prefix) {
    tree.forEach(item => {
        if (item.is_dir) {
            const option = document.createElement('option');
            option.value = item.path;
            option.textContent = (prefix ? prefix + ' / ' : '') + item.name;
            select.appendChild(option);
            if (item.children) {
                addFolderOptions(item.children, select, item.path);
            }
        }
    });
}

// 显示上传模态框
function showUploadModal() {
    document.getElementById('uploadModal').classList.add('show');
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadProgress').classList.remove('show');
}

// 显示创建文件夹模态框
function showCreateFolderModal(parent = '') {
    const modal = document.getElementById('createFolderModal');
    modal.classList.add('show');
    const input = document.getElementById('folderNameInput');
    input.value = '';
    if (parent) {
        document.getElementById('createFolderSelect').value = parent;
    } else {
        document.getElementById('createFolderSelect').value = '';
    }
    // 聚焦输入框
    setTimeout(() => input.focus(), 100);
}

// 显示移动模态框
function showMoveModal(path) {
    currentSelectedPath = path;
    const select = document.getElementById('moveTargetSelect');
    select.innerHTML = '<option value="">根目录</option>';
    addFolderOptionsForMove(fileTree, select, '', path);
    document.getElementById('moveModal').classList.add('show');
}

// 为移动功能添加文件夹选项（排除当前项及其子项）
function addFolderOptionsForMove(tree, select, prefix, excludePath) {
    tree.forEach(item => {
        if (item.is_dir) {
            // 排除当前要移动的文件夹及其子文件夹
            if (item.path !== excludePath && !item.path.startsWith(excludePath + '/')) {
                const option = document.createElement('option');
                option.value = item.path;
                option.textContent = (prefix ? prefix + ' / ' : '') + item.name;
                select.appendChild(option);
                if (item.children) {
                    addFolderOptionsForMove(item.children, select, item.path, excludePath);
                }
            }
        }
    });
}

// 关闭模态框
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

// 上传文件
async function startUpload() {
    const fileInput = document.getElementById('fileInput');
    const files = fileInput.files;
    const targetFolder = document.getElementById('uploadFolderSelect').value;

    if (files.length === 0) {
        showAlert('请选择文件', 'error');
        return;
    }

    const progressDiv = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    progressDiv.classList.add('show');

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);
        if (targetFolder) {
            formData.append('folder', targetFolder);
        }

        try {
            progressText.textContent = `上传中: ${file.name} (${i + 1}/${files.length})`;
            
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    progressFill.style.width = percent + '%';
                }
            });

            await new Promise((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status === 200) {
                        const data = JSON.parse(xhr.responseText);
                        if (data.success) {
                            resolve();
                        } else {
                            reject(new Error(data.error));
                        }
                    } else {
                        reject(new Error('上传失败'));
                    }
                };
                xhr.onerror = () => reject(new Error('网络错误'));
                xhr.open('POST', '/api/upload');
                xhr.send(formData);
            });
        } catch (error) {
            showAlert(`上传失败: ${error.message}`, 'error');
            progressDiv.classList.remove('show');
            return;
        }
    }

    progressText.textContent = '上传完成！';
    progressDiv.classList.remove('show');
    closeModal('uploadModal');
    loadTree();
    showAlert('文件上传成功！', 'success');
}

// 创建文件夹
async function createFolder() {
    const name = document.getElementById('folderNameInput').value.trim();
    const parent = document.getElementById('createFolderSelect').value;

    if (!name) {
        showAlert('请输入文件夹名称', 'error');
        return;
    }

    try {
        const response = await fetch('/api/create-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, parent })
        });

        const data = await response.json();

        if (data.success) {
            closeModal('createFolderModal');
            loadTree();
            showAlert('文件夹创建成功！', 'success');
        } else {
            showAlert(`创建失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`创建失败: ${error.message}`, 'error');
    }
}

// 移动文件/文件夹
async function moveItem() {
    const target = document.getElementById('moveTargetSelect').value;

    try {
        const response = await fetch('/api/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: currentSelectedPath, target: target })
        });

        const data = await response.json();

        if (data.success) {
            closeModal('moveModal');
            loadTree();
            showAlert('移动成功！', 'success');
        } else {
            showAlert(`移动失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`移动失败: ${error.message}`, 'error');
    }
}

// 下载文件
function downloadFile(path) {
    window.location.href = `/api/download?path=${encodeURIComponent(path)}`;
}

// 预览文件
function previewFile(path) {
    window.open(`/api/preview?path=${encodeURIComponent(path)}`, '_blank');
}

// 删除文件/文件夹
async function deleteItem(path, isDir) {
    const type = isDir ? '文件夹' : '文件';
    if (!confirm(`确定要删除${type} "${path}" 吗？`)) {
        return;
    }

    try {
        const response = await fetch('/api/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });

        const data = await response.json();

        if (data.success) {
            // 记录删除操作到历史
            addToHistory({
                type: 'delete',
                undo_id: data.undo_id,
                original_path: path,
                item: data.item
            });
            
            loadTree();
            showAlert(`${type}删除成功！按 Ctrl+Z 可撤销`, 'success');
        } else {
            showAlert(`删除失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`删除失败: ${error.message}`, 'error');
    }
}

// 添加到操作历史
function addToHistory(operation) {
    operationHistory.unshift(operation);
    if (operationHistory.length > MAX_HISTORY) {
        operationHistory.pop();
    }
}

// 撤销操作
async function undoLastOperation() {
    if (operationHistory.length === 0) {
        showAlert('没有可撤销的操作', 'error');
        return;
    }

    const lastOp = operationHistory[0];
    
    if (lastOp.type === 'delete') {
        try {
            const response = await fetch('/api/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    undo_id: lastOp.undo_id
                })
            });

            const data = await response.json();

            if (data.success) {
                operationHistory.shift(); // 移除已撤销的操作
                loadTree();
                showAlert('撤销成功！', 'success');
            } else {
                showAlert(`撤销失败: ${data.error}`, 'error');
            }
        } catch (error) {
            showAlert(`撤销失败: ${error.message}`, 'error');
        }
    } else {
        showAlert('该操作不支持撤销', 'error');
    }
}

// 恢复文件/文件夹
async function restoreItem(undoId) {
    try {
        const response = await fetch('/api/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ undo_id: undoId })
        });

        const data = await response.json();

        if (data.success) {
            loadTree();
            showAlert('恢复成功！', 'success');
        } else {
            showAlert(`恢复失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`恢复失败: ${error.message}`, 'error');
    }
}

// 一键恢复所有文件
async function restoreAllItems() {
    if (!confirm('确定要恢复回收站中的所有文件吗？')) {
        return;
    }

    try {
        const response = await fetch('/api/restore-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            loadTree();
            showAlert(data.message, 'success');
        } else {
            showAlert(`恢复失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`恢复失败: ${error.message}`, 'error');
    }
}

// 清空回收站
async function emptyTrash() {
    if (!confirm('确定要清空回收站吗？此操作不可撤销！')) {
        return;
    }

    try {
        const response = await fetch('/api/empty-trash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            loadTree();
            showAlert(data.message, 'success');
        } else {
            showAlert(`清空失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`清空失败: ${error.message}`, 'error');
    }
}

// 永久删除
async function permanentDeleteItem(undoId) {
    if (!confirm('确定要永久删除此文件吗？此操作不可撤销！')) {
        return;
    }

    try {
        const response = await fetch('/api/permanent-delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ undo_id: undoId })
        });

        const data = await response.json();

        if (data.success) {
            loadTree();
            showAlert('永久删除成功！', 'success');
        } else {
            showAlert(`删除失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`删除失败: ${error.message}`, 'error');
    }
}

// 键盘快捷键
document.addEventListener('keydown', (e) => {
    // Ctrl+Z 或 Cmd+Z (Mac) 撤销
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoLastOperation();
    }
});

// 加载存储统计
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        if (data.success) {
            document.getElementById('storageInfo').innerHTML = 
                `📦 已用空间: ${data.total_size_human}`;
        }
    } catch (error) {
        console.error('加载统计失败:', error);
    }
}

// 加载服务器信息
async function loadServerInfo() {
    try {
        const response = await fetch('/api/server-info');
        const data = await response.json();

        if (data.success) {
            const serverInfoEl = document.getElementById('serverInfo');
            serverInfoEl.innerHTML = 
                `🌐 内网地址: <span class="server-url" onclick="copyServerUrl('${data.url}')" title="点击复制">${data.local_ip}:${data.port}</span>`;
        }
    } catch (error) {
        console.error('加载服务器信息失败:', error);
        document.getElementById('serverInfo').innerHTML = 
            `🌐 内网地址: 获取失败`;
    }
}

// 复制服务器地址
function copyServerUrl(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showAlert('地址已复制到剪贴板！', 'success');
        }).catch(() => {
            fallbackCopyTextToClipboard(url);
        });
    } else {
        fallbackCopyTextToClipboard(url);
    }
}

// 备用复制方法
function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showAlert('地址已复制到剪贴板！', 'success');
    } catch (err) {
        showAlert('复制失败，请手动复制', 'error');
    }
    document.body.removeChild(textArea);
}

// 显示提示消息
function showAlert(message, type = 'success') {
    const alertContainer = document.getElementById('alertContainer');
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} show`;
    alert.textContent = message;
    alertContainer.appendChild(alert);

    setTimeout(() => {
        alert.classList.remove('show');
        setTimeout(() => alert.remove(), 300);
    }, 3000);
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 点击模态框外部关闭
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
        }
    });
});

// 为输入框添加回车键支持
document.getElementById('folderNameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        createFolder();
    }
});

document.getElementById('fileNameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        createFile();
    }
});

document.getElementById('renameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        renameItem();
    }
});

// 拖拽开始
function handleDragStart(e) {
    const itemDiv = e.target.closest('.tree-item');
    if (!itemDiv) {
        e.preventDefault();
        return;
    }
    
    draggedItem = {
        path: itemDiv.dataset.path,
        isDir: itemDiv.dataset.isDir === 'true'
    };
    
    const contentDiv = e.target.closest('.tree-item-content');
    if (contentDiv) {
        contentDiv.classList.add('dragging');
    }
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedItem.path);
    
    // 显示根目录拖放区域
    const rootDropZone = document.getElementById('rootDropZone');
    if (rootDropZone) {
        rootDropZone.style.display = 'block';
    }
}

// 拖拽结束
function handleDragEnd(e) {
    e.target.closest('.tree-item-content')?.classList.remove('dragging');
    
    // 清除所有拖拽样式
    document.querySelectorAll('.drag-over, .drag-over-folder').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-folder');
    });
    
    // 隐藏根目录拖放区域
    const rootDropZone = document.getElementById('rootDropZone');
    if (rootDropZone) {
        rootDropZone.style.display = 'none';
    }
    
    draggedItem = null;
}

// 拖拽悬停
function handleDragOver(e) {
    if (!draggedItem) {
        e.preventDefault();
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    
    const target = e.currentTarget;
    const itemDiv = target.closest('.tree-item');
    
    // 清除之前的拖拽样式
    document.querySelectorAll('.drag-over, .drag-over-folder').forEach(el => {
        if (el !== target) {
            el.classList.remove('drag-over', 'drag-over-folder');
        }
    });
    
    // 检查是否可以拖放到此位置
    if (itemDiv) {
        const targetPath = itemDiv.dataset.path;
        const targetIsDir = itemDiv.dataset.isDir === 'true';
        
        // 不能拖放到自己或自己的子文件夹
        if (draggedItem.path === targetPath || 
            (targetIsDir && draggedItem.path.startsWith(targetPath + '/'))) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        
        // 只有文件夹可以作为拖放目标
        if (targetIsDir) {
            target.classList.add('drag-over-folder');
        }
    } else if (target.id === 'rootDropZone') {
        // 根目录拖放区域
        // 检查是否已经在根目录
        if (!draggedItem.path.includes('/')) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        target.classList.add('drag-over');
    }
}

// 拖拽离开
function handleDragLeave(e) {
    const target = e.currentTarget;
    target.classList.remove('drag-over', 'drag-over-folder');
}

// 放置
async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedItem) return;
    
    const target = e.currentTarget;
    const itemDiv = target.closest('.tree-item');
    let targetFolder = '';
    
    if (itemDiv) {
        const targetPath = itemDiv.dataset.path;
        const targetIsDir = itemDiv.dataset.isDir === 'true';
        
        // 检查是否可以拖放到此位置
        if (draggedItem.path === targetPath || 
            (targetIsDir && draggedItem.path.startsWith(targetPath + '/'))) {
            target.classList.remove('drag-over', 'drag-over-folder');
            return;
        }
        
        // 只有文件夹可以作为拖放目标
        if (targetIsDir) {
            targetFolder = targetPath;
        } else {
            target.classList.remove('drag-over', 'drag-over-folder');
            return;
        }
    } else if (target.id === 'rootDropZone') {
        targetFolder = '';
    } else {
        return;
    }
    
    target.classList.remove('drag-over', 'drag-over-folder');
    
    // 执行移动
    try {
        const response = await fetch('/api/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                source: draggedItem.path, 
                target: targetFolder 
            })
        });

        const data = await response.json();

        if (data.success) {
            showAlert('移动成功！', 'success');
            loadTree();
        } else {
            showAlert(`移动失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`移动失败: ${error.message}`, 'error');
    }
    
    draggedItem = null;
}

// 右键菜单处理
function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const itemDiv = e.target.closest('.tree-item');
    if (!itemDiv) {
        // 在空白区域右键，显示创建菜单
        contextMenuTarget = { path: '', isDir: false, isRoot: true };
        showContextMenu(e.pageX, e.pageY, true);
        return;
    }
    
    const path = itemDiv.dataset.path;
    const isDir = itemDiv.dataset.isDir === 'true';
    const isTrash = itemDiv.dataset.isTrash === 'true';
    const undoId = itemDiv.dataset.undoId || null;
    
    contextMenuTarget = { path, isDir, isRoot: false, isTrash, undo_id: undoId };
    selectItem(path, isDir, e);
    showContextMenu(e.pageX, e.pageY, false);
}

// 显示右键菜单
function showContextMenu(x, y, isRoot) {
    const menu = document.getElementById('contextMenu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('show');
    
    const isFile = contextMenuTarget && !contextMenuTarget.isRoot && !contextMenuTarget.isDir;
    const isTrash = contextMenuTarget && contextMenuTarget.path === '.trash';
    const isTrashItem = contextMenuTarget && contextMenuTarget.isTrash;
    
    // 隐藏所有菜单项
    document.getElementById('menuCreateFile').style.display = 'none';
    document.getElementById('menuCreateFolder').style.display = 'none';
    document.getElementById('menuRename').style.display = 'none';
    document.getElementById('menuMove').style.display = 'none';
    document.getElementById('menuEditImage').style.display = 'none';
    document.getElementById('menuPdfToJpg').style.display = 'none';
    document.getElementById('menuRestore').style.display = 'none';
    document.getElementById('menuRestoreAll').style.display = 'none';
    document.getElementById('menuEmptyTrash').style.display = 'none';
    document.getElementById('menuDelete').style.display = 'none';
    document.getElementById('menuPermanentDelete').style.display = 'none';
    document.getElementById('menuDivider1').style.display = 'none';
    document.getElementById('menuDivider2').style.display = 'none';
    
    if (isRoot) {
        // 根目录：只显示新建文件和新建文件夹
        document.getElementById('menuCreateFile').style.display = 'flex';
        document.getElementById('menuCreateFolder').style.display = 'flex';
    } else if (isTrash) {
        // .trash文件夹：显示一键恢复和清空回收站
        document.getElementById('menuRestoreAll').style.display = 'flex';
        document.getElementById('menuEmptyTrash').style.display = 'flex';
        document.getElementById('menuDivider1').style.display = 'block';
    } else if (isTrashItem) {
        // .trash中的文件：显示恢复和永久删除
        document.getElementById('menuRestore').style.display = 'flex';
        document.getElementById('menuPermanentDelete').style.display = 'flex';
        document.getElementById('menuDivider1').style.display = 'block';
    } else if (isFile) {
        // 普通文件：不显示新建文件夹
        document.getElementById('menuCreateFile').style.display = 'flex';
        document.getElementById('menuRename').style.display = 'flex';
        document.getElementById('menuMove').style.display = 'flex';
        document.getElementById('menuDelete').style.display = 'flex';
        document.getElementById('menuDivider1').style.display = 'block';
        document.getElementById('menuDivider2').style.display = 'block';
        
        // 如果是图片文件，显示编辑图片选项
        if (contextMenuTarget && isImageFile(contextMenuTarget.path)) {
            document.getElementById('menuEditImage').style.display = 'flex';
        }
        
        // 如果是PDF文件，显示导出为JPG选项
        if (contextMenuTarget && contextMenuTarget.path.toLowerCase().endsWith('.pdf')) {
            document.getElementById('menuPdfToJpg').style.display = 'flex';
        }
    } else {
        // 普通文件夹：显示所有菜单项
        document.getElementById('menuCreateFile').style.display = 'flex';
        document.getElementById('menuCreateFolder').style.display = 'flex';
        document.getElementById('menuRename').style.display = 'flex';
        document.getElementById('menuMove').style.display = 'flex';
        document.getElementById('menuDelete').style.display = 'flex';
        document.getElementById('menuDivider1').style.display = 'block';
        document.getElementById('menuDivider2').style.display = 'block';
    }
}

// 隐藏右键菜单
function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    menu.classList.remove('show');
}

// 右键菜单：创建文件
function contextMenuCreateFile() {
    hideContextMenu();
    const parent = contextMenuTarget?.isRoot ? '' : (contextMenuTarget?.isDir ? contextMenuTarget.path : '');
    showCreateFileModal(parent);
}

// 右键菜单：创建文件夹
function contextMenuCreateFolder() {
    hideContextMenu();
    const parent = contextMenuTarget?.isRoot ? '' : (contextMenuTarget?.isDir ? contextMenuTarget.path : '');
    showCreateFolderModal(parent);
}

// 右键菜单：重命名
function contextMenuRename() {
    hideContextMenu();
    if (contextMenuTarget && !contextMenuTarget.isRoot) {
        showRenameModal(contextMenuTarget.path);
    }
}

// 右键菜单：移动
function contextMenuMove() {
    hideContextMenu();
    if (contextMenuTarget && !contextMenuTarget.isRoot) {
        showMoveModal(contextMenuTarget.path);
    }
}

// 右键菜单：删除
function contextMenuDelete() {
    hideContextMenu();
    if (contextMenuTarget && !contextMenuTarget.isRoot) {
        deleteItem(contextMenuTarget.path, contextMenuTarget.isDir);
    }
}

// 右键菜单：恢复
function contextMenuRestore() {
    hideContextMenu();
    if (contextMenuTarget && contextMenuTarget.isTrash && contextMenuTarget.undo_id) {
        restoreItem(contextMenuTarget.undo_id);
    }
}

// 右键菜单：一键恢复
function contextMenuRestoreAll() {
    hideContextMenu();
    if (contextMenuTarget && contextMenuTarget.path === '.trash') {
        restoreAllItems();
    }
}

// 右键菜单：清空回收站
function contextMenuEmptyTrash() {
    hideContextMenu();
    if (contextMenuTarget && contextMenuTarget.path === '.trash') {
        emptyTrash();
    }
}

// 右键菜单：永久删除
function contextMenuPermanentDelete() {
    hideContextMenu();
    if (contextMenuTarget && contextMenuTarget.isTrash && contextMenuTarget.undo_id) {
        permanentDeleteItem(contextMenuTarget.undo_id);
    }
}

// 右键菜单：编辑图片
function contextMenuEditImage() {
    hideContextMenu();
    if (contextMenuTarget && !contextMenuTarget.isRoot && !contextMenuTarget.isDir) {
        openImageEditor(contextMenuTarget.path);
    }
}

// 右键菜单：PDF导出为JPG
function contextMenuPdfToJpg() {
    hideContextMenu();
    if (contextMenuTarget && !contextMenuTarget.isRoot && !contextMenuTarget.isDir) {
        exportPdfToJpg(contextMenuTarget.path);
    }
}

// 检查是否为图片文件
function isImageFile(path) {
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const ext = path.toLowerCase().substring(path.lastIndexOf('.'));
    return imageExts.includes(ext);
}

// 显示创建文件模态框
function showCreateFileModal(parent = '') {
    const modal = document.getElementById('createFileModal');
    modal.classList.add('show');
    const input = document.getElementById('fileNameInput');
    input.value = '';
    if (parent) {
        document.getElementById('createFileFolderSelect').value = parent;
    } else {
        document.getElementById('createFileFolderSelect').value = '';
    }
    // 聚焦输入框
    setTimeout(() => input.focus(), 100);
}

// 显示重命名模态框
function showRenameModal(path) {
    const modal = document.getElementById('renameModal');
    modal.classList.add('show');
    const input = document.getElementById('renameInput');
    const name = path.split('/').pop();
    input.value = name;
    setTimeout(() => {
        input.select();
        input.focus();
    }, 100);
}

// 创建文件
async function createFile() {
    const name = document.getElementById('fileNameInput').value.trim();
    const parent = document.getElementById('createFileFolderSelect').value;

    if (!name) {
        showAlert('请输入文件名称', 'error');
        return;
    }

    try {
        const response = await fetch('/api/create-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, parent })
        });

        const data = await response.json();

        if (data.success) {
            closeModal('createFileModal');
            loadTree();
            showAlert('文件创建成功！', 'success');
        } else {
            showAlert(`创建失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`创建失败: ${error.message}`, 'error');
    }
}

// 重命名
async function renameItem() {
    if (!contextMenuTarget || contextMenuTarget.isRoot) {
        return;
    }

    const newName = document.getElementById('renameInput').value.trim();

    if (!newName) {
        showAlert('请输入新名称', 'error');
        return;
    }

    try {
        const response = await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                path: contextMenuTarget.path, 
                new_name: newName 
            })
        });

        const data = await response.json();

        if (data.success) {
            closeModal('renameModal');
            loadTree();
            showAlert('重命名成功！', 'success');
        } else {
            showAlert(`重命名失败: ${data.error}`, 'error');
        }
    } catch (error) {
        showAlert(`重命名失败: ${error.message}`, 'error');
    }
}

// 点击其他地方关闭右键菜单
document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu') && !e.target.closest('.tree-item-content')) {
        hideContextMenu();
    }
});

// 为文件浏览器区域添加右键菜单（空白区域）
document.getElementById('fileBrowser').addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.tree-item')) {
        e.preventDefault();
        contextMenuTarget = { path: '', isDir: false, isRoot: true };
        showContextMenu(e.pageX, e.pageY, true);
    }
});

// 搜索功能
document.getElementById('searchInput').addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    // 清除之前的搜索定时器
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    const resultsDiv = document.getElementById('searchResults');
    
    if (!query) {
        resultsDiv.classList.remove('show');
        return;
    }
    
    // 延迟搜索，避免频繁请求
    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            
            if (data.success) {
                displaySearchResults(data.results, data.count);
            } else {
                resultsDiv.innerHTML = `<div class="search-result-item">搜索失败: ${data.error}</div>`;
                resultsDiv.classList.add('show');
            }
        } catch (error) {
            resultsDiv.innerHTML = `<div class="search-result-item">搜索失败: ${error.message}</div>`;
            resultsDiv.classList.add('show');
        }
    }, 300);
});

// 高亮匹配的文字
function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    
    const escapedText = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    
    return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}

// 显示搜索结果
function displaySearchResults(results, count) {
    const resultsDiv = document.getElementById('searchResults');
    const query = document.getElementById('searchInput').value.trim();
    
    if (results.length === 0) {
        resultsDiv.innerHTML = '<div class="search-result-item">未找到匹配的文件或文件夹</div>';
        resultsDiv.classList.add('show');
        return;
    }
    
    let html = `<div class="search-result-count">找到 ${count} 个结果</div>`;
    
    results.forEach(result => {
        let iconHtml;
        if (result.is_dir) {
            iconHtml = '📁';
        } else if (result.type === 'image') {
            iconHtml = `<img src="/api/preview?path=${encodeURIComponent(result.path)}" alt="${escapeHtml(result.name)}" loading="lazy" onerror="this.outerHTML='🖼️'">`;
        } else {
            iconHtml = getFileIcon(result.type, result.ext);
        }
        const highlightedName = highlightText(result.name, query);
        const highlightedPath = highlightText(result.path, query);
        
        html += `
            <div class="search-result-item" onclick="navigateToItem('${escapeHtml(result.path)}', ${result.is_dir})">
                <span class="search-result-icon ${result.type === 'image' ? 'search-result-thumbnail' : ''}">${iconHtml}</span>
                <div class="search-result-info">
                    <div class="search-result-name">${highlightedName}</div>
                    <div class="search-result-path">${highlightedPath}</div>
                </div>
            </div>
        `;
    });
    
    resultsDiv.innerHTML = html;
    resultsDiv.classList.add('show');
}

// 导航到指定文件/文件夹
function navigateToItem(path, isDir) {
    // 保存当前展开状态
    saveExpandedState();
    
    // 隐藏搜索结果
    document.getElementById('searchResults').classList.remove('show');
    document.getElementById('searchInput').value = '';
    
    // 展开路径上的所有父文件夹
    const pathParts = path.split('/');
    const pathsToExpand = [];
    for (let i = 1; i < pathParts.length; i++) {
        pathsToExpand.push(pathParts.slice(0, i).join('/'));
    }
    
    // 重新加载树并展开路径
    loadTree().then(() => {
        // 展开所有父文件夹
        pathsToExpand.forEach(parentPath => {
            expandPath(parentPath);
        });
        
        // 滚动到目标项并选中
        setTimeout(() => {
            scrollToItem(path);
            selectItem(path, isDir, null);
        }, 100);
    });
}

// 保存当前展开状态
function saveExpandedState() {
    expandedPaths.clear();
    document.querySelectorAll('.tree-toggle.expanded').forEach(toggle => {
        const item = toggle.closest('.tree-item');
        if (item) {
            const path = item.dataset.path;
            if (path) {
                expandedPaths.add(path);
            }
        }
    });
}

// 展开指定路径
function expandPath(path) {
    document.querySelectorAll('.tree-item').forEach(item => {
        if (item.dataset.path === path) {
            const toggle = item.querySelector('.tree-toggle');
            const children = item.querySelector('.tree-children');
            
            if (toggle && children && toggle.classList.contains('collapsed')) {
                toggle.classList.remove('collapsed');
                toggle.classList.add('expanded');
                children.classList.add('expanded');
            }
        }
    });
}

// 滚动到指定项
function scrollToItem(path) {
    document.querySelectorAll('.tree-item').forEach(item => {
        if (item.dataset.path === path) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 高亮显示
            const content = item.querySelector('.tree-item-content');
            if (content) {
                content.classList.add('selected');
                setTimeout(() => {
                    content.style.background = '#fff3cd';
                    setTimeout(() => {
                        content.style.background = '';
                    }, 2000);
                }, 100);
            }
        }
    });
}

// 恢复展开状态
function restoreExpandedState() {
    expandedPaths.forEach(path => {
        expandPath(path);
    });
}

// PDF导出为JPG
async function exportPdfToJpg(path) {
    if (!path || !path.toLowerCase().endsWith('.pdf')) {
        showAlert('只能导出PDF文件', 'error');
        return;
    }

    try {
        showAlert('正在转换PDF为JPG，请稍候...', 'info');
        
        const response = await fetch('/api/pdf-to-jpg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path })
        });

        // 检查响应类型
        const contentType = response.headers.get('Content-Type');
        console.log('Response Content-Type:', contentType);
        
        if (!response.ok) {
            // 尝试解析错误信息
            let errorMsg = '转换失败';
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) {
                errorMsg = await response.text() || errorMsg;
            }
            throw new Error(errorMsg);
        }

        // 检查响应是否为ZIP文件
        if (!contentType || !contentType.includes('zip') && !contentType.includes('octet-stream')) {
            // 如果不是ZIP文件，可能是错误信息
            const text = await response.text();
            try {
                const errorData = JSON.parse(text);
                throw new Error(errorData.error || '转换失败');
            } catch (e) {
                throw new Error('服务器返回了非ZIP文件');
            }
        }

        // 获取文件名
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'images.zip';
        if (contentDisposition) {
            // 尝试多种方式解析文件名
            let matches = contentDisposition.match(/filename\*?=['"]?([^'";]+)['"]?/i);
            if (matches && matches[1]) {
                filename = matches[1];
                // 处理UTF-8编码的文件名
                if (filename.includes("UTF-8''")) {
                    filename = decodeURIComponent(filename.split("UTF-8''")[1]);
                } else if (filename.startsWith("UTF-8''")) {
                    filename = decodeURIComponent(filename.substring(7));
                }
            } else {
                // 尝试另一种格式
                matches = contentDisposition.match(/filename=([^;]+)/);
                if (matches && matches[1]) {
                    filename = matches[1].trim().replace(/['"]/g, '');
                }
            }
        }
        
        console.log('Download filename:', filename);

        // 下载文件
        const blob = await response.blob();
        console.log('Blob size:', blob.size, 'bytes');
        
        if (blob.size === 0) {
            throw new Error('下载的文件为空，可能转换失败');
        }
        
        // 显示成功消息和下载提示
        const fileSizeMB = (blob.size / (1024 * 1024)).toFixed(2);
        showAlert(`✅ 转换成功！文件大小: ${fileSizeMB}MB，正在下载...`, 'success');
        
        // 创建下载链接
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        
        // 创建一个可见的下载按钮作为备选方案
        const alertContainer = document.getElementById('alertContainer');
        let downloadBtn = null;
        
        if (alertContainer) {
            // 移除之前的下载按钮（如果有）
            const oldBtn = alertContainer.querySelector('.pdf-download-btn');
            if (oldBtn) oldBtn.remove();
            
            downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn btn-success pdf-download-btn';
            downloadBtn.style.margin = '10px 0';
            downloadBtn.style.display = 'block';
            downloadBtn.innerHTML = `📥 点击下载: ${filename} (${fileSizeMB}MB)`;
            downloadBtn.onclick = (e) => {
                e.preventDefault();
                a.click();
                downloadBtn.innerHTML = '✅ 下载中...';
                downloadBtn.disabled = true;
                setTimeout(() => {
                    downloadBtn.remove();
                    window.URL.revokeObjectURL(url);
                }, 2000);
            };
            alertContainer.appendChild(downloadBtn);
        }
        
        // 尝试自动触发下载
        try {
            a.click();
            
            // 延迟清理，确保下载开始
            setTimeout(() => {
                if (downloadBtn && downloadBtn.parentNode) {
                    // 如果按钮还在，说明可能需要手动下载
                    downloadBtn.innerHTML = `📥 点击下载: ${filename} (${fileSizeMB}MB) - 如果未自动下载`;
                } else {
                    // 下载成功，清理
                    if (document.body.contains(a)) {
                        document.body.removeChild(a);
                    }
                    window.URL.revokeObjectURL(url);
                }
            }, 2000);
            
            // 显示最终提示
            setTimeout(() => {
                showAlert(`📦 下载完成！文件名: ${filename}，请检查浏览器的下载文件夹（通常在"下载"文件夹中）。如果未自动下载，请点击上方的下载按钮。`, 'success');
            }, 1000);
        } catch (error) {
            console.error('自动下载失败:', error);
            showAlert('⚠️ 自动下载可能被浏览器阻止，请点击上方的下载按钮手动下载', 'warning');
        }
    } catch (error) {
        console.error('PDF转JPG失败:', error);
        showAlert(`转换失败: ${error.message}`, 'error');
    }
}

// 点击其他地方关闭搜索结果
document.addEventListener('click', (e) => {
    const searchBox = document.querySelector('.search-box');
    if (!searchBox.contains(e.target)) {
        document.getElementById('searchResults').classList.remove('show');
    }
});

// ==================== 图像编辑功能 ====================

let editorCanvas, editorCtx;
let originalImage = null;
let originalImageFull = null; // 原始完整尺寸图片
let baseImage = null; // 基础图像（原图，不包含画笔）
let currentImagePath = '';
let currentTool = null;
let cropStartX, cropStartY, cropEndX, cropEndY;
let isCropping = false;
let cropRatio = null; // 裁剪比例 {w: 1, h: 1} 或 null
let scaleX = 1, scaleY = 1; // 画布相对于原图的缩放比例
let perspectivePoints = [];
let isDrawing = false;
let drawStartX, drawStartY;
let textElements = [];
let selectedTextIndex = -1; // 当前选中的文字索引
let isDraggingText = false;
let editingTextIndex = -1; // 正在编辑的文字索引
let arrowElements = [];
let isBrushDrawing = false; // 涂抹画笔模式
let brushSize = 5; // 画笔粗细（默认最小）
// 工具颜色配置
let toolColors = {
    text: '#000000',    // 文字默认颜色
    arrow: '#ff0000',   // 箭头默认颜色
    mosaic: '#000000'   // 涂抹默认颜色
};
let brushColor = toolColors.mosaic; // 画笔颜色（涂抹工具使用）
let lastBrushX = null;
let lastBrushY = null;
let brushLayerCanvas = null; // 独立的画笔图层 canvas
let brushLayerCtx = null; // 画笔图层的 context
let historyStack = []; // 历史记录栈
let historyIndex = -1; // 当前历史记录索引
const MAX_EDITOR_HISTORY = 10;

// 性能优化：使用 requestAnimationFrame 节流箭头预览绘制
let arrowPreviewAnimationFrame = null;
let cachedBaseImage = null; // 缓存基础图像（原图+已保存的元素）

// 打开图像编辑器
async function openImageEditor(imagePath) {
    currentImagePath = imagePath;
    const modal = document.getElementById('imageEditorModal');
    modal.classList.add('show');
    
    // 清空历史记录
    historyStack = [];
    historyIndex = -1;
    
    // 加载图片
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        editorCanvas = document.getElementById('editorCanvas');
        if (!editorCanvas) return;
        editorCtx = editorCanvas.getContext('2d');
        
        // 保存完整尺寸的原始图片
        originalImageFull = img;
        
        // 设置画布大小
        const maxWidth = window.innerWidth * 0.7;
        const maxHeight = window.innerHeight * 0.7;
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
        }
        if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
        }
        
        // 计算缩放比例
        scaleX = width / img.width;
        scaleY = height / img.height;
        
        editorCanvas.width = width;
        editorCanvas.height = height;
        
        // 保存缩放后的图片用于显示
        originalImage = img;
        baseImage = img; // 保存基础图像（不包含画笔）
        
        // 初始化画笔图层
        initBrushLayer();
        
        // 重置所有状态
        resetEditorState();
        
        // 初始化单选框选中状态的类（只初始化当前显示的工具）
        const currentToolGroup = document.querySelector(`.size-control-group[data-tool="${currentTool}"]`);
        if (currentToolGroup) {
            const radios = currentToolGroup.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                const label = radio.closest('.size-radio-label');
                if (radio.checked && label) {
                    label.classList.add('radio-checked');
                }
            });
        }
        
        // 绘制图片
        drawImage();
        
        // 保存初始状态到历史记录
        saveHistory();
        
        // 绑定事件
        setupEditorEvents();
    };
    
    img.src = `/api/preview?path=${encodeURIComponent(imagePath)}`;
}

// 编辑器事件监听器引用（用于移除）
let editorEventHandlers = {
    mousedown: null,
    mousemove: null,
    mouseup: null,
    click: null,
    keydown: null
};

// 设置编辑器事件
function setupEditorEvents() {
    if (!editorCanvas) return;
    
    // 先移除旧的事件监听器（如果存在）
    removeEditorEvents();
    
    // 创建事件处理函数
    editorEventHandlers.mousedown = handleEditorMouseDown;
    editorEventHandlers.mousemove = handleEditorMouseMove;
    editorEventHandlers.mouseup = handleEditorMouseUp;
    editorEventHandlers.click = handleEditorClick;
    editorEventHandlers.keydown = handleEditorKeyDown;
    
    // 鼠标事件
    editorCanvas.addEventListener('mousedown', editorEventHandlers.mousedown);
    editorCanvas.addEventListener('mousemove', editorEventHandlers.mousemove);
    editorCanvas.addEventListener('mouseup', editorEventHandlers.mouseup);
    editorCanvas.addEventListener('click', editorEventHandlers.click);
    
    // 键盘事件
    document.addEventListener('keydown', editorEventHandlers.keydown);
}

// 移除编辑器事件
function removeEditorEvents() {
    if (editorCanvas && editorEventHandlers.mousedown) {
        editorCanvas.removeEventListener('mousedown', editorEventHandlers.mousedown);
        editorCanvas.removeEventListener('mousemove', editorEventHandlers.mousemove);
        editorCanvas.removeEventListener('mouseup', editorEventHandlers.mouseup);
        editorCanvas.removeEventListener('click', editorEventHandlers.click);
    }
    if (editorEventHandlers.keydown) {
        document.removeEventListener('keydown', editorEventHandlers.keydown);
    }
    // 重置引用
    editorEventHandlers = {
        mousedown: null,
        mousemove: null,
        mouseup: null,
        click: null,
        keydown: null
    };
}

// 键盘事件处理
function handleEditorKeyDown(e) {
    // 如果正在编辑文字，优先处理文字编辑
    if (editingTextIndex >= 0) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            finishTextEditing();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            const textInput = document.getElementById('textEditorInput');
            if (textInput) {
                textInput.style.display = 'none';
                editingTextIndex = -1;
            }
            return;
        }
    }
    
    // 撤销/前进 (Ctrl+Z / Ctrl+Shift+Z 或 Cmd+Z / Cmd+Shift+Z)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redoEdit();
        return;
    }
    
    // 裁剪时按Enter确认
    if (currentTool === 'crop' && cropStartX !== undefined && cropEndX !== undefined) {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyCrop();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            cancelCrop();
            return;
        }
    }
    
    // 透视变换时按Enter确认
    if (currentTool === 'perspective' && perspectivePoints.length === 4) {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyPerspective();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            cancelPerspective();
            return;
        }
    }
}

// 更新裁剪比例
function updateCropRatio() {
    const ratioSelect = document.getElementById('cropRatio');
    const value = ratioSelect.value;
    
    if (value === 'free') {
        cropRatio = null;
    } else {
        const [w, h] = value.split(':').map(Number);
        cropRatio = { w, h };
    }
    
    // 如果正在裁剪，重新计算裁剪框
    if (isCropping && cropStartX !== undefined && cropEndX !== undefined) {
        recalculateCropBox();
    }
}

// 重新计算裁剪框（根据固定比例）
function recalculateCropBox() {
    if (!cropRatio) return;
    
    const dx = cropEndX - cropStartX;
    const dy = cropEndY - cropStartY;
    const currentRatio = Math.abs(dx / (dy || 1));
    const targetRatio = cropRatio.w / cropRatio.h;
    
    if (currentRatio > targetRatio) {
        // 宽度太大，调整高度
        const newHeight = Math.abs(dx) / targetRatio;
        cropEndY = cropStartY + (dy > 0 ? newHeight : -newHeight);
    } else {
        // 高度太大，调整宽度
        const newWidth = Math.abs(dy) * targetRatio;
        cropEndX = cropStartX + (dx > 0 ? newWidth : -newWidth);
    }
    
    // 限制在画布范围内
    cropEndX = Math.max(0, Math.min(editorCanvas.width, cropEndX));
    cropEndY = Math.max(0, Math.min(editorCanvas.height, cropEndY));
    
    drawImage();
}

// 显示裁剪预览
function showCropPreview() {
    if (cropStartX === undefined || cropEndX === undefined) return;
    
    const x = Math.min(cropStartX, cropEndX);
    const y = Math.min(cropStartY, cropEndY);
    const width = Math.abs(cropEndX - cropStartX);
    const height = Math.abs(cropEndY - cropStartY);
    
    if (width < 10 || height < 10) return;
    
    // 计算原图坐标
    const origX = x / scaleX;
    const origY = y / scaleY;
    const origWidth = width / scaleX;
    const origHeight = height / scaleY;
    
    // 检查是否需要使用原图
    let sourceImage = originalImage;
    let sourceWidth = editorCanvas.width;
    let sourceHeight = editorCanvas.height;
    
    // 如果裁剪框超出当前预览图，使用原图
    if (origX + origWidth > originalImageFull.width || origY + origHeight > originalImageFull.height) {
        sourceImage = originalImageFull;
        sourceWidth = originalImageFull.width;
        sourceHeight = originalImageFull.height;
    }
    
    // 创建预览canvas
    const previewCanvas = document.createElement('canvas');
    const previewCtx = previewCanvas.getContext('2d');
    previewCanvas.width = width;
    previewCanvas.height = height;
    
    // 绘制裁剪区域
    previewCtx.drawImage(
        sourceImage,
        Math.max(0, Math.min(origX, sourceWidth)),
        Math.max(0, Math.min(origY, sourceHeight)),
        Math.min(origWidth, sourceWidth - Math.max(0, origX)),
        Math.min(origHeight, sourceHeight - Math.max(0, origY)),
        0, 0, width, height
    );
    
    // 更新显示（可选：在画布上显示预览）
    drawImage();
    
    // 在裁剪框内绘制预览
    editorCtx.save();
    editorCtx.globalAlpha = 0.7;
    editorCtx.drawImage(previewCanvas, x, y);
    editorCtx.globalAlpha = 1.0;
    editorCtx.restore();
}

// 编辑器鼠标事件处理
function handleEditorMouseDown(e) {
    const rect = editorCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 首先检查是否点击了文字元素（无论当前工具是什么）
    let clickedText = false;
    for (let i = textElements.length - 1; i >= 0; i--) {
        const elem = textElements[i];
        editorCtx.save();
        editorCtx.font = `${elem.size}px ${elem.font}`;
        editorCtx.textAlign = 'center';
        editorCtx.textBaseline = 'middle';
        const metrics = editorCtx.measureText(elem.text);
        const textWidth = metrics.width;
        const textHeight = elem.size;
        
        if (x >= elem.x - textWidth/2 && x <= elem.x + textWidth/2 &&
            y >= elem.y - textHeight/2 && y <= elem.y + textHeight/2) {
            selectedTextIndex = i;
            isDraggingText = true; // 无论什么工具都可以拖拽
            clickedText = true;
            editorCtx.restore();
            break;
        }
        editorCtx.restore();
    }
    
    if (currentTool === 'text') {
        if (!clickedText) {
            selectedTextIndex = -1;
        }
    } else if (currentTool === 'crop' || currentTool === 'arrow') {
        const rect = editorCanvas.getBoundingClientRect();
        drawStartX = e.clientX - rect.left;
        drawStartY = e.clientY - rect.top;
        isDrawing = true;
        
        if (currentTool === 'crop') {
            cropStartX = drawStartX;
            cropStartY = drawStartY;
            isCropping = true;
        }
    } else if (currentTool === 'mosaic') {
        const rect = editorCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        isBrushDrawing = true;
        // 初始化画笔图层
        initBrushLayer();
        // 在开始新的涂抹前，先重绘所有历史内容（包括已保存的涂抹、文字、箭头等）
        redrawCanvas();
        // 重置位置，确保第一个点能正确绘制
        lastBrushX = null;
        lastBrushY = null;
        // 开始绘制
        applyBrush(x, y);
    }
}

function handleEditorMouseMove(e) {
    const rect = editorCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (currentTool === 'crop' && isCropping) {
        // 限制裁剪框在画布范围内
        cropEndX = Math.max(0, Math.min(editorCanvas.width, x));
        cropEndY = Math.max(0, Math.min(editorCanvas.height, y));
        
        // 如果设置了固定比例，调整裁剪框
        if (cropRatio) {
            recalculateCropBox();
        } else {
            drawImage();
        }
    } else if (isDraggingText && selectedTextIndex >= 0) {
        // 拖拽文字（无论当前工具是什么）
        textElements[selectedTextIndex].x = x;
        textElements[selectedTextIndex].y = y;
        drawImage();
    } else if (currentTool === 'mosaic' && isBrushDrawing) {
        // 涂抹画笔
        applyBrush(x, y);
    } else if (currentTool === 'arrow' && isDrawing && drawStartX !== undefined && drawStartY !== undefined) {
        const endX = x;
        const endY = y;
        // 保存鼠标事件，以便在更新画笔大小时可以重新绘制预览
        window.lastMouseEvent = e;
        
        // 使用 requestAnimationFrame 节流，避免频繁重绘
        if (arrowPreviewAnimationFrame) {
            cancelAnimationFrame(arrowPreviewAnimationFrame);
        }
        
        arrowPreviewAnimationFrame = requestAnimationFrame(() => {
            // 只重绘预览箭头，不重绘整个画布
            drawArrowPreviewOptimized(drawStartX, drawStartY, endX, endY);
            arrowPreviewAnimationFrame = null;
        });
    }
}

function handleEditorMouseUp(e) {
    if (isDraggingText) {
        isDraggingText = false;
        saveHistory(); // 保存历史记录
    } else if (currentTool === 'arrow' && isDrawing) {
        // 取消待处理的预览动画帧
        if (arrowPreviewAnimationFrame) {
            cancelAnimationFrame(arrowPreviewAnimationFrame);
            arrowPreviewAnimationFrame = null;
        }
        
        const rect = editorCanvas.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        
        const type = document.getElementById('arrowType').value;
        const color = toolColors.arrow; // 使用统一的颜色配置
        const size = brushSize; // 使用共享的画笔大小
        
        arrowElements.push({
            x1: drawStartX,
            y1: drawStartY,
            x2: endX,
            y2: endY,
            type: type,
            color: color,
            size: size
        });
        isDrawing = false;
        drawImage(); // 完整重绘以更新缓存
        saveHistory(); // 保存历史记录
    } else if (currentTool === 'mosaic' && isBrushDrawing) {
        // 取消待处理的重绘请求
        if (brushRedrawFrame !== null) {
            cancelAnimationFrame(brushRedrawFrame);
            brushRedrawFrame = null;
        }
        // 立即执行最后一次重绘，确保所有画笔内容都显示
        redrawCanvas();
        
        isBrushDrawing = false;
        // 将画笔绘制的内容合并到 originalImage
        // 注意：mergeBrushToImage 内部会异步更新 originalImage 并调用 drawImage 和 saveHistory
        mergeBrushToImage();
        lastBrushX = null;
        lastBrushY = null;
        // saveHistory 已在 mergeBrushToImage 的 mergedImg.onload 回调中调用
    } else if (currentTool === 'crop' && isCropping) {
        isCropping = false;
        // 显示裁剪预览
        showCropPreview();
    }
}

function handleEditorClick(e) {
    if (currentTool === 'perspective' && perspectivePoints.length < 4) {
        const rect = editorCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        perspectivePoints.push({ x, y });
        drawImage();
    } else if (currentTool === 'text') {
        const rect = editorCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 检查是否点击了现有文字
        let clickedText = false;
        for (let i = textElements.length - 1; i >= 0; i--) {
            const elem = textElements[i];
            editorCtx.save();
            editorCtx.font = `${elem.size}px ${elem.font}`;
            editorCtx.textAlign = 'center';
            editorCtx.textBaseline = 'middle';
            const metrics = editorCtx.measureText(elem.text);
            const textWidth = metrics.width;
            const textHeight = elem.size;
            
            if (x >= elem.x - textWidth/2 && x <= elem.x + textWidth/2 &&
                y >= elem.y - textHeight/2 && y <= elem.y + textHeight/2) {
                selectedTextIndex = i;
                editingTextIndex = i;
                clickedText = true;
                showTextEditor(i);
                break;
            }
            editorCtx.restore();
        }
        
        // 如果没有点击现有文字，添加新文字
        if (!clickedText) {
            const text = document.getElementById('textContent').value || '示例文字';
            const font = document.getElementById('textFont').value;
            const size = parseInt(document.getElementById('textSize').value);
            const color = toolColors.text; // 使用统一的颜色配置
            
            textElements.push({
                text: text,
                x: x,
                y: y,
                font: font,
                size: size,
                color: color
            });
            selectedTextIndex = textElements.length - 1;
            editingTextIndex = textElements.length - 1;
            showTextEditor(textElements.length - 1);
            drawImage();
            saveHistory();
        }
    }
}

// 重置编辑器状态
function resetEditorState() {
    currentTool = null;
    isCropping = false;
    cropRatio = null;
    perspectivePoints = [];
    // 取消待处理的重绘请求
    if (brushRedrawFrame !== null) {
        cancelAnimationFrame(brushRedrawFrame);
        brushRedrawFrame = null;
    }
    textElements = [];
    selectedTextIndex = -1;
    editingTextIndex = -1;
    isDraggingText = false;
    arrowElements = [];
    isBrushDrawing = false;
    lastBrushX = null;
    lastBrushY = null;
    
    // 清除画笔图层
    clearBrushLayer();
    
    // 清理箭头预览动画帧
    if (arrowPreviewAnimationFrame) {
        cancelAnimationFrame(arrowPreviewAnimationFrame);
        arrowPreviewAnimationFrame = null;
    }
    
    // 清除缓存
    cachedBaseImage = null;
    
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tool-options').forEach(opt => opt.style.display = 'none');
    if (document.getElementById('cropRatio')) {
        document.getElementById('cropRatio').value = 'free';
    }
    const textInput = document.getElementById('textEditorInput');
    if (textInput) {
        textInput.style.display = 'none';
    }
}

// 更新缓存的基础图像（原图+已保存的元素）
function updateCachedBaseImage() {
    if (!originalImage || !editorCanvas || !editorCtx) {
        cachedBaseImage = null;
        return;
    }
    
    // 创建离屏 canvas 来缓存基础图像
    const cacheCanvas = document.createElement('canvas');
    cacheCanvas.width = editorCanvas.width;
    cacheCanvas.height = editorCanvas.height;
    const cacheCtx = cacheCanvas.getContext('2d');
    
    // 绘制原图+已保存的画笔（使用 originalImage，如果它包含画笔内容）
    // 这样缓存中就包含了所有已保存的画笔内容
    if (baseImage && originalImage !== baseImage) {
        // originalImage 已经包含了 baseImage + 所有已保存的画笔，直接使用
        cacheCtx.drawImage(originalImage, 0, 0, editorCanvas.width, editorCanvas.height);
    } else {
        // 没有已保存的画笔，使用 baseImage
        cacheCtx.drawImage(baseImage || originalImage, 0, 0, editorCanvas.width, editorCanvas.height);
    }
    
    // 绘制所有已保存的元素（不包括选中状态的虚线边框，因为那是预览效果）
    textElements.forEach((elem) => {
        cacheCtx.save();
        cacheCtx.font = `${elem.size}px ${elem.font}`;
        cacheCtx.fillStyle = elem.color;
        cacheCtx.textAlign = 'center';
        cacheCtx.textBaseline = 'middle';
        cacheCtx.fillText(elem.text, elem.x, elem.y);
        cacheCtx.restore();
    });
    
    arrowElements.forEach(elem => {
        cacheCtx.save();
        cacheCtx.strokeStyle = elem.color;
        cacheCtx.fillStyle = elem.color;
        cacheCtx.lineWidth = elem.size;
        cacheCtx.lineCap = 'round';
        cacheCtx.lineJoin = 'round';
        
        const dx = elem.x2 - elem.x1;
        const dy = elem.y2 - elem.y1;
        const angle = Math.atan2(dy, dx);
        const arrowLength = elem.size * 4;
        const arrowAngle = Math.PI / 6;
        
        // 绘制箭头线
        cacheCtx.beginPath();
        cacheCtx.moveTo(elem.x1, elem.y1);
        cacheCtx.lineTo(elem.x2, elem.y2);
        cacheCtx.stroke();
        
        // 绘制箭头头部
        if (elem.type === 'simple' || elem.type === 'filled') {
            cacheCtx.beginPath();
            cacheCtx.moveTo(elem.x2, elem.y2);
            cacheCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
            );
            cacheCtx.moveTo(elem.x2, elem.y2);
            cacheCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
            );
            cacheCtx.stroke();
            
            if (elem.type === 'filled') {
                cacheCtx.beginPath();
                cacheCtx.moveTo(elem.x2, elem.y2);
                cacheCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                cacheCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                cacheCtx.closePath();
                cacheCtx.fill();
            }
        } else if (elem.type === 'double') {
            // 起点箭头
            cacheCtx.beginPath();
            cacheCtx.moveTo(elem.x1, elem.y1);
            cacheCtx.lineTo(
                elem.x1 + arrowLength * Math.cos(angle - arrowAngle),
                elem.y1 + arrowLength * Math.sin(angle - arrowAngle)
            );
            cacheCtx.moveTo(elem.x1, elem.y1);
            cacheCtx.lineTo(
                elem.x1 + arrowLength * Math.cos(angle + arrowAngle),
                elem.y1 + arrowLength * Math.sin(angle + arrowAngle)
            );
            cacheCtx.stroke();
            
            // 终点箭头
            cacheCtx.beginPath();
            cacheCtx.moveTo(elem.x2, elem.y2);
            cacheCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
            );
            cacheCtx.moveTo(elem.x2, elem.y2);
            cacheCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
            );
            cacheCtx.stroke();
        }
        cacheCtx.restore();
    });
    
    // 直接保存 canvas 引用，而不是转换为 Image（避免异步加载问题）
    cachedBaseImage = cacheCanvas;
}

// 重绘画布（优化版本，使用独立的画笔图层）
function redrawCanvas() {
    if (!originalImage || !editorCtx) return;
    
    editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    
    // 正确的绘制顺序：原图 -> 已保存的画笔 -> 文字 -> 箭头 -> 当前画笔图层（最顶层）
    // 1. 如果 originalImage 包含已保存的画笔内容（与 baseImage 不同），直接绘制 originalImage
    //    否则绘制 baseImage（原图，不包含画笔）
    if (baseImage && originalImage !== baseImage) {
        // originalImage 已经包含了 baseImage + 所有已保存的画笔，直接绘制
        editorCtx.drawImage(originalImage, 0, 0, editorCanvas.width, editorCanvas.height);
    } else {
        // 没有已保存的画笔，绘制基础图像（原图，不包含画笔）
        editorCtx.drawImage(baseImage || originalImage, 0, 0, editorCanvas.width, editorCanvas.height);
    }
    
    // 3. 绘制文字
    textElements.forEach((elem, index) => drawTextElement(elem, index));
    
    // 4. 绘制箭头
    arrowElements.forEach(elem => drawArrow(elem));
    
    // 5. 绘制当前画笔图层（在文字和箭头之上，最顶层）
    // 直接绘制画笔图层，无需检查内容（性能优化）
    if (brushLayerCanvas && brushLayerCtx) {
        editorCtx.drawImage(brushLayerCanvas, 0, 0);
    }
}

// 绘制图片（保持向后兼容）
function drawImage() {
    redrawCanvas();
    
    // 更新缓存
    updateCachedBaseImage();
    
    // 绘制裁剪框
    if (isCropping) {
        drawCropBox();
    }
    
    // 绘制透视变换点和范围
    if (currentTool === 'perspective') {
        // 绘制已选中的点
        perspectivePoints.forEach((point, index) => {
            editorCtx.fillStyle = '#ff0000';
            editorCtx.beginPath();
            editorCtx.arc(point.x, point.y, 8, 0, Math.PI * 2);
            editorCtx.fill();
            editorCtx.strokeStyle = '#ffffff';
            editorCtx.lineWidth = 2;
            editorCtx.stroke();
            
            // 显示点序号
            editorCtx.fillStyle = '#ffffff';
            editorCtx.font = '12px Arial';
            editorCtx.textAlign = 'center';
            editorCtx.fillText((index + 1).toString(), point.x, point.y - 12);
        });
        
        // 如果有4个点，绘制连接线显示范围
        if (perspectivePoints.length === 4) {
            editorCtx.strokeStyle = '#00ff00';
            editorCtx.lineWidth = 2;
            editorCtx.setLineDash([5, 5]);
            editorCtx.beginPath();
            editorCtx.moveTo(perspectivePoints[0].x, perspectivePoints[0].y);
            for (let i = 1; i < 4; i++) {
                editorCtx.lineTo(perspectivePoints[i].x, perspectivePoints[i].y);
            }
            editorCtx.closePath();
            editorCtx.stroke();
            editorCtx.setLineDash([]);
            
            // 填充选中区域
            editorCtx.fillStyle = 'rgba(0, 255, 0, 0.1)';
            editorCtx.fill();
        } else if (perspectivePoints.length > 0) {
            // 绘制部分连接线
            editorCtx.strokeStyle = '#ffff00';
            editorCtx.lineWidth = 2;
            editorCtx.setLineDash([3, 3]);
            editorCtx.beginPath();
            editorCtx.moveTo(perspectivePoints[0].x, perspectivePoints[0].y);
            for (let i = 1; i < perspectivePoints.length; i++) {
                editorCtx.lineTo(perspectivePoints[i].x, perspectivePoints[i].y);
            }
            editorCtx.stroke();
            editorCtx.setLineDash([]);
        }
    }
}

// 设置编辑工具
function setEditorTool(tool) {
    // 保存旧工具
    const oldTool = currentTool;
    
    // 在切换工具前，确保所有未保存的编辑内容都已保存
    // 1. 如果之前正在绘制涂抹，先合并画笔图层
    if (oldTool === 'mosaic' && (isBrushDrawing || (brushLayerCanvas && brushLayerCtx))) {
        // 检查画笔图层是否有内容
        if (brushLayerCanvas && brushLayerCtx) {
            const imageData = brushLayerCtx.getImageData(0, 0, brushLayerCanvas.width, brushLayerCanvas.height);
            const data = imageData.data;
            let hasBrushContent = false;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 0) {
                    hasBrushContent = true;
                    break;
                }
            }
            if (hasBrushContent) {
                // 同步合并画笔图层（不等待异步完成）
                mergeBrushToImageSync();
            }
        }
        isBrushDrawing = false;
        lastBrushX = null;
        lastBrushY = null;
        // 清除画笔图层
        clearBrushLayer();
    }
    
    // 现在设置新工具
    currentTool = tool;
    
    // 更新按钮状态
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tool === tool) {
            btn.classList.add('active');
        }
    });
    
    // 显示/隐藏选项面板
    document.querySelectorAll('.tool-options').forEach(opt => opt.style.display = 'none');
    const optionsPanel = document.getElementById(tool + 'Options');
    if (optionsPanel) {
        optionsPanel.style.display = 'block';
    }
    
    // 更新当前工具的单选框状态，确保显示正确的选中状态
    if (tool === 'arrow' || tool === 'mosaic') {
        const toolGroup = document.querySelector(`.size-control-group[data-tool="${tool}"]`);
        if (toolGroup) {
            const radios = toolGroup.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                const radioValue = parseInt(radio.value);
                const label = radio.closest('.size-radio-label');
                if (radioValue === brushSize) {
                    radio.checked = true;
                    if (label) {
                        label.classList.add('radio-checked');
                    }
                } else {
                    radio.checked = false;
                    if (label) {
                        label.classList.remove('radio-checked');
                    }
                }
            });
            // 更新输入框的值
            const input = toolGroup.querySelector('.size-input');
            if (input) {
                input.value = brushSize;
            }
        }
    }
    
    // 2. 确保所有编辑内容都已合并到 originalImage（用于裁剪和透视变换）
    // 创建一个临时 canvas 来合并所有内容（原图+画笔+文字+箭头）
    // 但只在切换到裁剪或透视变换工具时才需要这样做
    if ((tool === 'crop' || tool === 'perspective') && baseImage && (textElements.length > 0 || arrowElements.length > 0 || (originalImage !== baseImage))) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = editorCanvas.width;
        tempCanvas.height = editorCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 绘制基础图像（包含已保存的画笔）
        if (originalImage !== baseImage) {
            tempCtx.drawImage(originalImage, 0, 0, editorCanvas.width, editorCanvas.height);
        } else {
            tempCtx.drawImage(baseImage, 0, 0, editorCanvas.width, editorCanvas.height);
        }
        
        // 绘制文字
        textElements.forEach(elem => {
            tempCtx.save();
            tempCtx.font = `${elem.size}px ${elem.font}`;
            tempCtx.fillStyle = elem.color;
            tempCtx.textAlign = 'center';
            tempCtx.textBaseline = 'middle';
            tempCtx.fillText(elem.text, elem.x, elem.y);
            tempCtx.restore();
        });
        
        // 绘制箭头
        arrowElements.forEach(elem => {
            tempCtx.save();
            tempCtx.strokeStyle = elem.color;
            tempCtx.fillStyle = elem.color;
            tempCtx.lineWidth = elem.size;
            tempCtx.lineCap = 'round';
            tempCtx.lineJoin = 'round';
            
            const dx = elem.x2 - elem.x1;
            const dy = elem.y2 - elem.y1;
            const angle = Math.atan2(dy, dx);
            const arrowLength = elem.size * 4;
            const arrowAngle = Math.PI / 6;
            
            tempCtx.beginPath();
            tempCtx.moveTo(elem.x1, elem.y1);
            tempCtx.lineTo(elem.x2, elem.y2);
            tempCtx.stroke();
            
            if (elem.type === 'simple' || elem.type === 'filled') {
                tempCtx.beginPath();
                tempCtx.moveTo(elem.x2, elem.y2);
                tempCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                tempCtx.moveTo(elem.x2, elem.y2);
                tempCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                tempCtx.stroke();
                
                if (elem.type === 'filled') {
                    tempCtx.beginPath();
                    tempCtx.moveTo(elem.x2, elem.y2);
                    tempCtx.lineTo(
                        elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                        elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
                    );
                    tempCtx.lineTo(
                        elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                        elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
                    );
                    tempCtx.closePath();
                    tempCtx.fill();
                }
            } else if (elem.type === 'double') {
                tempCtx.beginPath();
                tempCtx.moveTo(elem.x1, elem.y1);
                tempCtx.lineTo(
                    elem.x1 + arrowLength * Math.cos(angle - arrowAngle),
                    elem.y1 + arrowLength * Math.sin(angle - arrowAngle)
                );
                tempCtx.moveTo(elem.x1, elem.y1);
                tempCtx.lineTo(
                    elem.x1 + arrowLength * Math.cos(angle + arrowAngle),
                    elem.y1 + arrowLength * Math.sin(angle + arrowAngle)
                );
                tempCtx.stroke();
                
                tempCtx.beginPath();
                tempCtx.moveTo(elem.x2, elem.y2);
                tempCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                tempCtx.moveTo(elem.x2, elem.y2);
                tempCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                tempCtx.stroke();
            }
            tempCtx.restore();
        });
        
        // 同步更新 originalImage（不等待异步加载）
        const mergedImg = new Image();
        mergedImg.onload = () => {
            originalImage = mergedImg;
            // 注意：不要更新 baseImage，baseImage 应该保持为原始图像（不包含编辑内容）
            // 这样我们可以区分 originalImage 是否包含编辑内容
            // 更新缓存
            updateCachedBaseImage();
            // 重新绘制
            drawImage();
        };
        mergedImg.src = tempCanvas.toDataURL();
    }
    
    // 3. 重新绘制画布，确保显示最新的状态
    drawImage();
    
    // 4. 初始化工具颜色和大小
    if (tool === 'text' || tool === 'arrow' || tool === 'mosaic') {
        // 初始化颜色输入框
        const colorInput = document.querySelector(`.color-input[data-tool="${tool}"]`);
        if (colorInput) {
            colorInput.value = toolColors[tool];
            if (tool === 'mosaic') {
                brushColor = toolColors[tool];
            }
        }
        
        // 初始化大小控件（箭头和涂抹工具）
        if (tool === 'arrow' || tool === 'mosaic') {
            // 初始化画笔图层
            initBrushLayer();
            // 设置默认大小为5（最小）
            brushSize = 5;
            // 更新所有大小输入框
            const sizeInputs = document.querySelectorAll('.size-input');
            sizeInputs.forEach(input => {
                input.value = 5;
            });
            // 选中最小的单选框（只更新当前工具）
            const currentToolGroup = document.querySelector(`.size-control-group[data-tool="${currentTool}"]`);
            if (currentToolGroup) {
                const radios = currentToolGroup.querySelectorAll('input[type="radio"]');
                radios.forEach(radio => {
                    const label = radio.closest('.size-radio-label');
                    if (parseInt(radio.value) === 5) {
                        radio.checked = true;
                        if (label) {
                            label.classList.add('radio-checked');
                        }
                    } else {
                        radio.checked = false;
                        if (label) {
                            label.classList.remove('radio-checked');
                        }
                    }
                });
            }
        }
    }
    
    // 重置状态
    isCropping = false;
    isDrawing = false;
    perspectivePoints = [];
    isBrushDrawing = false;
    lastBrushX = null;
    lastBrushY = null;
    drawImage();
    
    // 设置鼠标样式
    updateCursorStyle(tool);
}

// 更新工具颜色（统一函数）
function updateToolColor(tool, color) {
    if (toolColors.hasOwnProperty(tool)) {
        toolColors[tool] = color;
        // 如果是涂抹工具，同时更新 brushColor
        if (tool === 'mosaic') {
            brushColor = color;
        }
        // 更新光标样式（如果是涂抹工具）
        if (tool === 'mosaic' && currentTool === 'mosaic') {
            updateCursorStyle('mosaic');
        }
    }
}

// 更新工具大小（统一函数，用于箭头和涂抹）
function updateToolSize(size) {
    // 防止循环调用
    if (isUpdatingBrushSize) return;
    
    // 如果大小没有变化，直接返回（但需要确保单选框状态正确）
    if (brushSize === size) {
        // 即使大小相同，也要确保当前工具的单选框状态正确
        const currentToolGroup = document.querySelector(`.size-control-group[data-tool="${currentTool}"]`);
        if (currentToolGroup) {
            const radios = currentToolGroup.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                const radioValue = parseInt(radio.value);
                const label = radio.closest('.size-radio-label');
                if (radioValue === size && !radio.checked) {
                    radio.checked = true;
                    if (label) {
                        label.classList.add('radio-checked');
                    }
                } else if (radio.checked) {
                    radio.checked = false;
                    if (label) {
                        label.classList.remove('radio-checked');
                    }
                }
            });
        }
        return;
    }
    
    isUpdatingBrushSize = true;
    brushSize = size;
    
    // 更新所有大小输入框的值
    const inputs = document.querySelectorAll('.size-input');
    inputs.forEach(input => {
        if (input && input.value !== size.toString()) {
            input.value = size;
        }
    });
    
    // 更新当前工具的单选框状态（只更新当前显示的工具面板）
    const currentToolGroup = document.querySelector(`.size-control-group[data-tool="${currentTool}"]`);
    if (currentToolGroup) {
        const radios = currentToolGroup.querySelectorAll('input[type="radio"]');
        radios.forEach(radio => {
            const radioValue = parseInt(radio.value);
            const label = radio.closest('.size-radio-label');
            if (radioValue === size) {
                if (!radio.checked) {
                    radio.checked = true;
                }
                // 添加选中状态的类（用于兼容不支持 :has() 的浏览器）
                if (label) {
                    label.classList.add('radio-checked');
                }
            } else {
                if (radio.checked) {
                    radio.checked = false;
                }
                // 移除选中状态的类
                if (label) {
                    label.classList.remove('radio-checked');
                }
            }
        });
    }
    
    isUpdatingBrushSize = false;
    
    // 更新光标样式
    if (currentTool === 'mosaic') {
        updateCursorStyle('mosaic');
    } else if (currentTool === 'arrow') {
        updateCursorStyle('arrow');
    }
    
    // 如果正在绘制箭头，使用优化的预览绘制
    if (currentTool === 'arrow' && isDrawing && drawStartX !== undefined && drawStartY !== undefined) {
        const mouseEvent = window.lastMouseEvent;
        if (mouseEvent && editorCanvas) {
            const rect = editorCanvas.getBoundingClientRect();
            const x = mouseEvent.clientX - rect.left;
            const y = mouseEvent.clientY - rect.top;
            
            // 使用优化的预览绘制，而不是完整的 drawImage
            if (arrowPreviewAnimationFrame) {
                cancelAnimationFrame(arrowPreviewAnimationFrame);
            }
            arrowPreviewAnimationFrame = requestAnimationFrame(() => {
                drawArrowPreviewOptimized(drawStartX, drawStartY, x, y);
                arrowPreviewAnimationFrame = null;
            });
        }
    }
}

// 从输入框更新工具大小
function updateToolSizeFromInput() {
    // 防止循环调用
    if (isUpdatingBrushSize) return;
    
    const inputs = document.querySelectorAll('.size-input');
    let inputValue = null;
    
    // 获取当前输入框的值
    inputs.forEach(input => {
        if (input && document.activeElement === input) {
            inputValue = parseInt(input.value) || 5;
        }
    });
    
    // 如果没有找到活动的输入框，使用第一个输入框的值
    if (inputValue === null && inputs.length > 0) {
        inputValue = parseInt(inputs[0].value) || 5;
    }
    
    if (inputValue !== null) {
        const newSize = Math.max(1, Math.min(100, inputValue)); // 限制在1-100之间
        
        // 如果大小没有变化，直接返回
        if (brushSize === newSize) return;
        
        isUpdatingBrushSize = true;
        brushSize = newSize;
        
        // 更新所有输入框的值
        inputs.forEach(input => {
            if (input && input.value !== newSize.toString()) {
                input.value = newSize;
            }
        });
        
        // 检查是否匹配预设值，如果匹配则选中对应的单选框（只更新当前工具）
        const currentToolGroup = document.querySelector(`.size-control-group[data-tool="${currentTool}"]`);
        if (currentToolGroup) {
            const radios = currentToolGroup.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                const radioValue = parseInt(radio.value);
                const label = radio.closest('.size-radio-label');
                if (radioValue === newSize) {
                    if (!radio.checked) {
                        radio.checked = true;
                    }
                    // 添加选中状态的类
                    if (label) {
                        label.classList.add('radio-checked');
                    }
                } else {
                    if (radio.checked) {
                        radio.checked = false;
                    }
                    // 移除选中状态的类
                    if (label) {
                        label.classList.remove('radio-checked');
                    }
                }
            });
        }
        
        isUpdatingBrushSize = false;
        
        // 更新光标样式
        if (currentTool === 'mosaic') {
            updateCursorStyle('mosaic');
        } else if (currentTool === 'arrow') {
            updateCursorStyle('arrow');
        }
        
        // 如果正在绘制箭头，使用优化的预览绘制
        if (currentTool === 'arrow' && isDrawing && drawStartX !== undefined && drawStartY !== undefined) {
            const mouseEvent = window.lastMouseEvent;
            if (mouseEvent && editorCanvas) {
                const rect = editorCanvas.getBoundingClientRect();
                const x = mouseEvent.clientX - rect.left;
                const y = mouseEvent.clientY - rect.top;
                
                if (arrowPreviewAnimationFrame) {
                    cancelAnimationFrame(arrowPreviewAnimationFrame);
                }
                arrowPreviewAnimationFrame = requestAnimationFrame(() => {
                    drawArrowPreviewOptimized(drawStartX, drawStartY, x, y);
                    arrowPreviewAnimationFrame = null;
                });
            }
        }
    }
}

// 更新鼠标样式
function updateCursorStyle(tool) {
    if (!editorCanvas) return;
    
    if (tool === 'crop' || tool === 'perspective' || tool === 'text') {
        editorCanvas.style.cursor = 'crosshair';
    } else if (tool === 'arrow') {
        // 箭头工具使用自定义圆形光标，大小与画笔大小一致
        const size = brushSize || 5;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="none" stroke="black" stroke-width="1"/></svg>`;
        const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        editorCanvas.style.cursor = `url('${dataUrl}') ${size/2} ${size/2}, crosshair`;
    } else if (tool === 'mosaic') {
        // 涂抹工具使用自定义圆形光标，颜色和大小与画笔一致
        const size = brushSize || 5;
        const color = brushColor || toolColors.mosaic;
        // 将颜色转换为RGB（用于SVG）
        const rgb = hexToRgb(color);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="none" stroke="rgb(${rgb.r},${rgb.g},${rgb.b})" stroke-width="1"/></svg>`;
        const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        editorCanvas.style.cursor = `url('${dataUrl}') ${size/2} ${size/2}, crosshair`;
    } else {
        editorCanvas.style.cursor = 'default';
    }
}

// 辅助函数：将十六进制颜色转换为RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

// 绘制裁剪框
function drawCropBox() {
    if (!isCropping || cropStartX === undefined) return;
    
    const x = Math.min(cropStartX, cropEndX || cropStartX);
    const y = Math.min(cropStartY, cropEndY || cropStartY);
    const width = Math.abs((cropEndX || cropStartX) - cropStartX);
    const height = Math.abs((cropEndY || cropStartY) - cropStartY);
    
    editorCtx.strokeStyle = '#667eea';
    editorCtx.lineWidth = 2;
    editorCtx.setLineDash([5, 5]);
    editorCtx.strokeRect(x, y, width, height);
    editorCtx.setLineDash([]);
    
    editorCtx.fillStyle = 'rgba(102, 126, 234, 0.1)';
    editorCtx.fillRect(x, y, width, height);
}

// 应用裁剪
function applyCrop() {
    if (cropStartX !== undefined && cropEndX !== undefined) {
        const x = Math.min(cropStartX, cropEndX);
        const y = Math.min(cropStartY, cropEndY);
        const width = Math.abs(cropEndX - cropStartX);
        const height = Math.abs(cropEndY - cropStartY);
        
        if (width > 10 && height > 10) {
            // 计算原图坐标
            const origX = x / scaleX;
            const origY = y / scaleY;
            const origWidth = width / scaleX;
            const origHeight = height / scaleY;
            
            // 限制在原图范围内
            const finalX = Math.max(0, Math.min(origX, originalImageFull.width));
            const finalY = Math.max(0, Math.min(origY, originalImageFull.height));
            const finalWidth = Math.min(origWidth, originalImageFull.width - finalX);
            const finalHeight = Math.min(origHeight, originalImageFull.height - finalY);
            
            // 先创建一个包含所有编辑内容的完整图像
            const fullCanvas = document.createElement('canvas');
            const fullCtx = fullCanvas.getContext('2d');
            fullCanvas.width = originalImageFull.width;
            fullCanvas.height = originalImageFull.height;
            
            // 1. 绘制原图（包含已保存的画笔）
            if (baseImage && originalImage !== baseImage) {
                const tempImgCanvas = document.createElement('canvas');
                const tempImgCtx = tempImgCanvas.getContext('2d');
                tempImgCanvas.width = originalImageFull.width;
                tempImgCanvas.height = originalImageFull.height;
                tempImgCtx.drawImage(originalImage, 0, 0, originalImageFull.width, originalImageFull.height);
                fullCtx.drawImage(tempImgCanvas, 0, 0);
            } else {
                fullCtx.drawImage(originalImageFull, 0, 0);
            }
            
            // 2. 绘制文字（按原始尺寸缩放）
            const textScaleX = originalImageFull.width / editorCanvas.width;
            const textScaleY = originalImageFull.height / editorCanvas.height;
            textElements.forEach(elem => {
                fullCtx.save();
                fullCtx.font = `${elem.size * textScaleY}px ${elem.font}`;
                fullCtx.fillStyle = elem.color;
                fullCtx.textAlign = 'center';
                fullCtx.textBaseline = 'middle';
                fullCtx.fillText(elem.text, elem.x * textScaleX, elem.y * textScaleY);
                fullCtx.restore();
            });
            
            // 3. 绘制箭头（按原始尺寸缩放）
            arrowElements.forEach(elem => {
                fullCtx.save();
                fullCtx.strokeStyle = elem.color;
                fullCtx.fillStyle = elem.color;
                fullCtx.lineWidth = elem.size * textScaleY;
                fullCtx.lineCap = 'round';
                fullCtx.lineJoin = 'round';
                
                const x1 = elem.x1 * textScaleX;
                const y1 = elem.y1 * textScaleY;
                const x2 = elem.x2 * textScaleX;
                const y2 = elem.y2 * textScaleY;
                const dx = x2 - x1;
                const dy = y2 - y1;
                const angle = Math.atan2(dy, dx);
                const arrowLength = elem.size * textScaleY * 4;
                const arrowAngle = Math.PI / 6;
                
                fullCtx.beginPath();
                fullCtx.moveTo(x1, y1);
                fullCtx.lineTo(x2, y2);
                fullCtx.stroke();
                
                if (elem.type === 'simple' || elem.type === 'filled') {
                    fullCtx.beginPath();
                    fullCtx.moveTo(x2, y2);
                    fullCtx.lineTo(
                        x2 - arrowLength * Math.cos(angle - arrowAngle),
                        y2 - arrowLength * Math.sin(angle - arrowAngle)
                    );
                    fullCtx.moveTo(x2, y2);
                    fullCtx.lineTo(
                        x2 - arrowLength * Math.cos(angle + arrowAngle),
                        y2 - arrowLength * Math.sin(angle + arrowAngle)
                    );
                    fullCtx.stroke();
                    
                    if (elem.type === 'filled') {
                        fullCtx.beginPath();
                        fullCtx.moveTo(x2, y2);
                        fullCtx.lineTo(
                            x2 - arrowLength * Math.cos(angle - arrowAngle),
                            y2 - arrowLength * Math.sin(angle - arrowAngle)
                        );
                        fullCtx.lineTo(
                            x2 - arrowLength * Math.cos(angle + arrowAngle),
                            y2 - arrowLength * Math.sin(angle + arrowAngle)
                        );
                        fullCtx.closePath();
                        fullCtx.fill();
                    }
                } else if (elem.type === 'double') {
                    fullCtx.beginPath();
                    fullCtx.moveTo(x1, y1);
                    fullCtx.lineTo(
                        x1 + arrowLength * Math.cos(angle - arrowAngle),
                        y1 + arrowLength * Math.sin(angle - arrowAngle)
                    );
                    fullCtx.moveTo(x1, y1);
                    fullCtx.lineTo(
                        x1 + arrowLength * Math.cos(angle + arrowAngle),
                        y1 + arrowLength * Math.sin(angle + arrowAngle)
                    );
                    fullCtx.stroke();
                    
                    fullCtx.beginPath();
                    fullCtx.moveTo(x2, y2);
                    fullCtx.lineTo(
                        x2 - arrowLength * Math.cos(angle - arrowAngle),
                        y2 - arrowLength * Math.sin(angle - arrowAngle)
                    );
                    fullCtx.moveTo(x2, y2);
                    fullCtx.lineTo(
                        x2 - arrowLength * Math.cos(angle + arrowAngle),
                        y2 - arrowLength * Math.sin(angle + arrowAngle)
                    );
                    fullCtx.stroke();
                }
                fullCtx.restore();
            });
            
            // 4. 如果有未保存的画笔图层，也需要合并
            if (brushLayerCanvas && brushLayerCtx) {
                const imageData = brushLayerCtx.getImageData(0, 0, brushLayerCanvas.width, brushLayerCanvas.height);
                const data = imageData.data;
                let hasBrushContent = false;
                for (let i = 3; i < data.length; i += 4) {
                    if (data[i] > 0) {
                        hasBrushContent = true;
                        break;
                    }
                }
                if (hasBrushContent) {
                    const brushScaleX = originalImageFull.width / editorCanvas.width;
                    const brushScaleY = originalImageFull.height / editorCanvas.height;
                    fullCtx.save();
                    fullCtx.scale(brushScaleX, brushScaleY);
                    fullCtx.drawImage(brushLayerCanvas, 0, 0);
                    fullCtx.restore();
                }
            }
            
            // 5. 从完整图像中裁剪指定区域
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = finalWidth;
            tempCanvas.height = finalHeight;
            
            tempCtx.drawImage(
                fullCanvas,
                finalX, finalY, finalWidth, finalHeight,
                0, 0, finalWidth, finalHeight
            );
            
            // 更新原始图片和缩放比例
            const img = new Image();
            img.onload = () => {
                originalImageFull = img;
                originalImage = img;
                baseImage = img; // 保存基础图像（不包含画笔）
                
                // 重新计算画布大小
                const maxWidth = window.innerWidth * 0.7;
                const maxHeight = window.innerHeight * 0.7;
                let newWidth = img.width;
                let newHeight = img.height;
                
                if (newWidth > maxWidth) {
                    newHeight = (newHeight * maxWidth) / newWidth;
                    newWidth = maxWidth;
                }
                if (newHeight > maxHeight) {
                    newWidth = (newWidth * maxHeight) / newHeight;
                    newHeight = maxHeight;
                }
                
                scaleX = newWidth / img.width;
                scaleY = newHeight / img.height;
                
                // 保存裁剪前的画布尺寸（在修改 editorCanvas 之前）
                const oldEditorWidth = editorCanvas.width;
                const oldEditorHeight = editorCanvas.height;
                
                editorCanvas.width = newWidth;
                editorCanvas.height = newHeight;
                
                // 重新缩放文字和箭头的位置（由于图像被裁剪，需要调整位置）
                // 注意：裁剪后文字和箭头的位置需要相对于新的图像原点调整
                const textScaleX = originalImageFull.width / oldEditorWidth;
                const textScaleY = originalImageFull.height / oldEditorHeight;
                
                // 过滤并调整文字位置（只保留在裁剪区域内的文字）
                textElements = textElements.filter(elem => {
                    const origX = elem.x * textScaleX;
                    const origY = elem.y * textScaleY;
                    // 检查文字是否在裁剪区域内
                    if (origX >= finalX && origX <= finalX + finalWidth &&
                        origY >= finalY && origY <= finalY + finalHeight) {
                        // 调整位置到新画布坐标
                        elem.x = (origX - finalX) * (newWidth / finalWidth);
                        elem.y = (origY - finalY) * (newHeight / finalHeight);
                        return true;
                    }
                    return false;
                });
                
                // 过滤并调整箭头位置（只保留在裁剪区域内的箭头）
                arrowElements = arrowElements.filter(elem => {
                    const origX1 = elem.x1 * textScaleX;
                    const origY1 = elem.y1 * textScaleY;
                    const origX2 = elem.x2 * textScaleX;
                    const origY2 = elem.y2 * textScaleY;
                    // 检查箭头是否至少有一部分在裁剪区域内
                    const minX = Math.min(origX1, origX2);
                    const maxX = Math.max(origX1, origX2);
                    const minY = Math.min(origY1, origY2);
                    const maxY = Math.max(origY1, origY2);
                    if (maxX >= finalX && minX <= finalX + finalWidth &&
                        maxY >= finalY && minY <= finalY + finalHeight) {
                        // 调整位置到新画布坐标
                        elem.x1 = (origX1 - finalX) * (newWidth / finalWidth);
                        elem.y1 = (origY1 - finalY) * (newHeight / finalHeight);
                        elem.x2 = (origX2 - finalX) * (newWidth / finalWidth);
                        elem.y2 = (origY2 - finalY) * (newHeight / finalHeight);
                        return true;
                    }
                    return false;
                });
                
                // 清除画笔图层
                clearBrushLayer();
                
                // 重置状态（但保留文字和箭头）
                isCropping = false;
                cropStartX = cropStartY = cropEndX = cropEndY = undefined;
                
                // 初始化画笔图层
                initBrushLayer();
                
                drawImage();
                saveHistory(); // 保存历史记录
            };
            img.src = tempCanvas.toDataURL();
        }
    }
}

// 取消裁剪
function cancelCrop() {
    isCropping = false;
    cropStartX = cropStartY = cropEndX = cropEndY = undefined;
    drawImage();
}

// 应用透视变换
function applyPerspective() {
    if (perspectivePoints.length === 4) {
        // 计算原图坐标
        const srcPoints = perspectivePoints.map(p => ({
            x: p.x / scaleX,
            y: p.y / scaleY
        }));
        
        // 计算目标矩形（使用原图的四个角，按顺序：左上、右上、右下、左下）
        const dstPoints = [
            { x: 0, y: 0 },
            { x: originalImageFull.width, y: 0 },
            { x: originalImageFull.width, y: originalImageFull.height },
            { x: 0, y: originalImageFull.height }
        ];
        
        // 先创建一个包含所有编辑内容的完整图像
        const fullCanvas = document.createElement('canvas');
        const fullCtx = fullCanvas.getContext('2d');
        fullCanvas.width = originalImageFull.width;
        fullCanvas.height = originalImageFull.height;
        
        // 1. 绘制原图（包含已保存的画笔）
        // 注意：originalImage 可能包含已保存的画笔内容，需要正确缩放并绘制
        // 在切换到透视工具时，setEditorTool 已经将所有内容合并到 originalImage 中
        // 但 originalImage 的尺寸是 editorCanvas 的尺寸（缩放后的），需要缩放到 originalImageFull 尺寸
        // 直接使用 drawImage 的缩放功能，将 originalImage 从 editorCanvas 尺寸缩放到 originalImageFull 尺寸
        // originalImage 的尺寸是 editorCanvas.width x editorCanvas.height
        // 需要缩放到 originalImageFull.width x originalImageFull.height
        // 注意：在 setEditorTool 切换到透视工具时，originalImage 和 baseImage 已经被设置为合并后的图像
        // 所以这里应该总是使用 originalImage（它已经包含了所有编辑内容）
        fullCtx.drawImage(originalImage, 0, 0, editorCanvas.width, editorCanvas.height, 
                         0, 0, originalImageFull.width, originalImageFull.height);
        
        // 注意：在 setEditorTool 切换到透视工具时，所有编辑内容（文字、箭头、涂抹）已经合并到 originalImage 中
        // 所以这里不需要再单独绘制文字和箭头，它们已经在 originalImage 中了
        // 但是，如果 originalImage 和 baseImage 相同（没有涂抹），则说明文字和箭头还没有合并到图像中
        // 为了安全起见，我们仍然绘制文字和箭头，但只在 originalImage === baseImage 时绘制
        
        // 2. 绘制文字（按原始尺寸缩放）- 只在 originalImage === baseImage 时绘制（因为涂抹时文字已经合并到 originalImage）
        const textScaleX = originalImageFull.width / editorCanvas.width;
        const textScaleY = originalImageFull.height / editorCanvas.height;
        
        // 如果 originalImage === baseImage，说明没有涂抹内容，文字和箭头还没有合并到图像中
        // 需要单独绘制；否则，文字和箭头已经在 originalImage 中了
        if (originalImage === baseImage) {
            textElements.forEach(elem => {
                fullCtx.save();
                fullCtx.font = `${elem.size * textScaleY}px ${elem.font}`;
                fullCtx.fillStyle = elem.color;
                fullCtx.textAlign = 'center';
                fullCtx.textBaseline = 'middle';
                fullCtx.fillText(elem.text, elem.x * textScaleX, elem.y * textScaleY);
                fullCtx.restore();
            });
            
            // 3. 绘制箭头（按原始尺寸缩放）
            arrowElements.forEach(elem => {
                fullCtx.save();
            fullCtx.strokeStyle = elem.color;
            fullCtx.fillStyle = elem.color;
            fullCtx.lineWidth = elem.size * textScaleY;
            fullCtx.lineCap = 'round';
            fullCtx.lineJoin = 'round';
            
            const x1 = elem.x1 * textScaleX;
            const y1 = elem.y1 * textScaleY;
            const x2 = elem.x2 * textScaleX;
            const y2 = elem.y2 * textScaleY;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const angle = Math.atan2(dy, dx);
            const arrowLength = elem.size * textScaleY * 4;
            const arrowAngle = Math.PI / 6;
            
            fullCtx.beginPath();
            fullCtx.moveTo(x1, y1);
            fullCtx.lineTo(x2, y2);
            fullCtx.stroke();
            
            if (elem.type === 'simple' || elem.type === 'filled') {
                fullCtx.beginPath();
                fullCtx.moveTo(x2, y2);
                fullCtx.lineTo(
                    x2 - arrowLength * Math.cos(angle - arrowAngle),
                    y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                fullCtx.moveTo(x2, y2);
                fullCtx.lineTo(
                    x2 - arrowLength * Math.cos(angle + arrowAngle),
                    y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                fullCtx.stroke();
                
                if (elem.type === 'filled') {
                    fullCtx.beginPath();
                    fullCtx.moveTo(x2, y2);
                    fullCtx.lineTo(
                        x2 - arrowLength * Math.cos(angle - arrowAngle),
                        y2 - arrowLength * Math.sin(angle - arrowAngle)
                    );
                    fullCtx.lineTo(
                        x2 - arrowLength * Math.cos(angle + arrowAngle),
                        y2 - arrowLength * Math.sin(angle + arrowAngle)
                    );
                    fullCtx.closePath();
                    fullCtx.fill();
                }
            } else if (elem.type === 'double') {
                fullCtx.beginPath();
                fullCtx.moveTo(x1, y1);
                fullCtx.lineTo(
                    x1 + arrowLength * Math.cos(angle - arrowAngle),
                    y1 + arrowLength * Math.sin(angle - arrowAngle)
                );
                fullCtx.moveTo(x1, y1);
                fullCtx.lineTo(
                    x1 + arrowLength * Math.cos(angle + arrowAngle),
                    y1 + arrowLength * Math.sin(angle + arrowAngle)
                );
                fullCtx.stroke();
                
                fullCtx.beginPath();
                fullCtx.moveTo(x2, y2);
                fullCtx.lineTo(
                    x2 - arrowLength * Math.cos(angle - arrowAngle),
                    y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                fullCtx.moveTo(x2, y2);
                fullCtx.lineTo(
                    x2 - arrowLength * Math.cos(angle + arrowAngle),
                    y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                fullCtx.stroke();
                }
                fullCtx.restore();
            });
        }
        
        // 4. 如果有未保存的画笔图层，也需要合并
        if (brushLayerCanvas && brushLayerCtx) {
            const imageData = brushLayerCtx.getImageData(0, 0, brushLayerCanvas.width, brushLayerCanvas.height);
            const data = imageData.data;
            let hasBrushContent = false;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 0) {
                    hasBrushContent = true;
                    break;
                }
            }
            if (hasBrushContent) {
                const brushScaleX = originalImageFull.width / editorCanvas.width;
                const brushScaleY = originalImageFull.height / editorCanvas.height;
                fullCtx.save();
                fullCtx.scale(brushScaleX, brushScaleY);
                fullCtx.drawImage(brushLayerCanvas, 0, 0);
                fullCtx.restore();
            }
        }
        
        // 创建新canvas进行透视变换
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = originalImageFull.width;
        tempCanvas.height = originalImageFull.height;
        
        // 使用drawImage的变换功能，通过4个点进行透视变换
        // 由于Canvas API不直接支持透视变换，我们使用像素级处理
        const srcImg = fullCanvas; // 使用包含所有编辑内容的完整图像
        const srcData = createImageDataFromImage(srcImg);
        const dstData = tempCtx.createImageData(tempCanvas.width, tempCanvas.height);
        
        // 计算透视变换矩阵
        const matrix = getPerspectiveTransform(srcPoints, dstPoints);
        
        // 对每个目标像素，计算对应的源像素位置
        for (let y = 0; y < tempCanvas.height; y++) {
            for (let x = 0; x < tempCanvas.width; x++) {
                // 应用逆变换找到源像素位置
                const srcPos = applyInverseTransform(x, y, matrix);
                
                if (srcPos.x >= 0 && srcPos.x < srcImg.width && 
                    srcPos.y >= 0 && srcPos.y < srcImg.height) {
                    const dstIdx = (y * tempCanvas.width + x) * 4;
                    
                    // 双线性插值
                    const x1 = Math.floor(srcPos.x);
                    const y1 = Math.floor(srcPos.y);
                    const x2 = Math.min(x1 + 1, srcImg.width - 1);
                    const y2 = Math.min(y1 + 1, srcImg.height - 1);
                    
                    const fx = srcPos.x - x1;
                    const fy = srcPos.y - y1;
                    
                    const idx11 = (y1 * srcImg.width + x1) * 4;
                    const idx12 = (y1 * srcImg.width + x2) * 4;
                    const idx21 = (y2 * srcImg.width + x1) * 4;
                    const idx22 = (y2 * srcImg.width + x2) * 4;
                    
                    for (let c = 0; c < 4; c++) {
                        const v11 = srcData.data[idx11 + c];
                        const v12 = srcData.data[idx12 + c];
                        const v21 = srcData.data[idx21 + c];
                        const v22 = srcData.data[idx22 + c];
                        
                        const v1 = v11 * (1 - fx) + v12 * fx;
                        const v2 = v21 * (1 - fx) + v22 * fx;
                        const v = v1 * (1 - fy) + v2 * fy;
                        
                        dstData.data[dstIdx + c] = Math.round(v);
                    }
                }
            }
        }
        
        tempCtx.putImageData(dstData, 0, 0);
        
        // 更新图片
        const img = new Image();
        img.onload = () => {
            originalImageFull = img;
            // 注意：透视变换后的图像已经包含了所有编辑内容（包括涂抹、文字、箭头）
            // 所以 originalImageFull 应该设置为变换后的图像
            originalImageFull = img;
            
            // 重新计算画布大小
            const maxWidth = window.innerWidth * 0.7;
            const maxHeight = window.innerHeight * 0.7;
            let newWidth = img.width;
            let newHeight = img.height;
            
            if (newWidth > maxWidth) {
                newHeight = (newHeight * maxWidth) / newWidth;
                newWidth = maxWidth;
            }
            if (newHeight > maxHeight) {
                newWidth = (newWidth * maxHeight) / newHeight;
                newHeight = maxHeight;
            }
            
            scaleX = newWidth / img.width;
            scaleY = newHeight / img.height;
            
            editorCanvas.width = newWidth;
            editorCanvas.height = newHeight;
            
            // 将变换后的图像缩放到 editorCanvas 尺寸用于显示
            const displayCanvas = document.createElement('canvas');
            displayCanvas.width = newWidth;
            displayCanvas.height = newHeight;
            const displayCtx = displayCanvas.getContext('2d');
            displayCtx.drawImage(img, 0, 0, newWidth, newHeight);
            const displayImg = new Image();
            displayImg.onload = () => {
                // 透视变换后的图像已经包含了所有编辑内容（包括涂抹）
                // 所以 originalImage 和 baseImage 都应该设置为变换后的图像
                originalImage = displayImg;
                baseImage = displayImg; // 透视变换后，baseImage 也更新为变换后的图像（因为涂抹已经合并到图像中）
                
                // 透视变换后，文字和箭头的位置需要重新映射
                // 由于透视变换是复杂的非线性变换，我们使用逆变换来重新映射位置
                // 注意：这里需要保存变换前的 srcPoints 和 matrix
                // 但由于变量作用域问题，我们需要重新计算
                // 简化处理：由于透视变换后图像尺寸不变，只需要重新映射位置
                // 但透视变换是非线性的，精确映射比较复杂
                // 为了简化，我们清除文字和箭头，因为它们的位置在透视变换后可能不准确
                // 用户可以在透视变换后重新添加文字和箭头
                textElements = [];
                arrowElements = [];
                
                // 清除画笔图层（涂抹内容已经合并到变换后的图像中）
                clearBrushLayer();
                
                // 重置状态
                perspectivePoints = [];
                
                // 初始化画笔图层
                initBrushLayer();
                
                drawImage();
                saveHistory(); // 保存历史记录
            };
            displayImg.src = displayCanvas.toDataURL();
        };
        img.src = tempCanvas.toDataURL();
    }
}

// 计算透视变换矩阵（使用齐次坐标）
function getPerspectiveTransform(src, dst) {
    // 构建8x8线性方程组求解透视变换矩阵
    const A = [];
    const b = [];
    
    for (let i = 0; i < 4; i++) {
        A.push([src[i].x, src[i].y, 1, 0, 0, 0, -src[i].x * dst[i].x, -src[i].y * dst[i].x]);
        A.push([0, 0, 0, src[i].x, src[i].y, 1, -src[i].x * dst[i].y, -src[i].y * dst[i].y]);
        b.push(dst[i].x);
        b.push(dst[i].y);
    }
    
    // 使用高斯消元法求解
    const h = solveGaussianElimination(A, b);
    
    return [
        h[0], h[1], h[2],
        h[3], h[4], h[5],
        h[6], h[7], 1
    ];
}

// 高斯消元法求解线性方程组
function solveGaussianElimination(A, b) {
    const n = A.length;
    const augmented = A.map((row, i) => [...row, b[i]]);
    
    // 前向消元
    for (let i = 0; i < n; i++) {
        // 找到主元
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
                maxRow = k;
            }
        }
        [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
        
        // 消元
        for (let k = i + 1; k < n; k++) {
            const factor = augmented[k][i] / augmented[i][i];
            for (let j = i; j < n + 1; j++) {
                augmented[k][j] -= factor * augmented[i][j];
            }
        }
    }
    
    // 回代
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        x[i] = augmented[i][n];
        for (let j = i + 1; j < n; j++) {
            x[i] -= augmented[i][j] * x[j];
        }
        x[i] /= augmented[i][i];
    }
    
    return x;
}

// 应用逆变换
function applyInverseTransform(x, y, matrix) {
    // 计算逆矩阵
    const det = matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
                matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
                matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6]);
    
    if (Math.abs(det) < 1e-10) {
        return { x, y };
    }
    
    const invDet = 1 / det;
    const invMatrix = [
        (matrix[4] * matrix[8] - matrix[5] * matrix[7]) * invDet,
        (matrix[2] * matrix[7] - matrix[1] * matrix[8]) * invDet,
        (matrix[1] * matrix[5] - matrix[2] * matrix[4]) * invDet,
        (matrix[5] * matrix[6] - matrix[3] * matrix[8]) * invDet,
        (matrix[0] * matrix[8] - matrix[2] * matrix[6]) * invDet,
        (matrix[2] * matrix[3] - matrix[0] * matrix[5]) * invDet,
        (matrix[3] * matrix[7] - matrix[4] * matrix[6]) * invDet,
        (matrix[1] * matrix[6] - matrix[0] * matrix[7]) * invDet,
        (matrix[0] * matrix[4] - matrix[1] * matrix[3]) * invDet
    ];
    
    const w = invMatrix[6] * x + invMatrix[7] * y + invMatrix[8];
    if (Math.abs(w) < 1e-10) {
        return { x, y };
    }
    
    return {
        x: (invMatrix[0] * x + invMatrix[1] * y + invMatrix[2]) / w,
        y: (invMatrix[3] * x + invMatrix[4] * y + invMatrix[5]) / w
    };
}

// 从Image对象创建ImageData
function createImageDataFromImage(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// 计算透视变换矩阵
function calculatePerspectiveMatrix(src, dst) {
    // 使用简化的方法计算透视变换
    // 这里使用仿射变换近似（实际透视变换需要更复杂的计算）
    const A = [];
    const b = [];
    
    for (let i = 0; i < 4; i++) {
        A.push([src[i].x, src[i].y, 1, 0, 0, 0, -src[i].x * dst[i].x, -src[i].y * dst[i].x]);
        A.push([0, 0, 0, src[i].x, src[i].y, 1, -src[i].x * dst[i].y, -src[i].y * dst[i].y]);
        b.push(dst[i].x);
        b.push(dst[i].y);
    }
    
    // 简化的解决方案：使用仿射变换
    // 计算最小二乘解
    const h = solveLinearSystem(A, b);
    
    return [
        h[0] || 1, h[1] || 0, h[2] || 0,
        h[3] || 0, h[4] || 1, h[5] || 0,
        h[6] || 0, h[7] || 0, 1
    ];
}

// 简化的线性方程组求解
function solveLinearSystem(A, b) {
    // 使用简化的方法：计算仿射变换
    // 这里使用一个简化的实现
    const src = [
        { x: A[0][0], y: A[0][1] },
        { x: A[2][0], y: A[2][1] },
        { x: A[4][0], y: A[4][1] }
    ];
    const dst = [
        { x: b[0], y: b[1] },
        { x: b[2], y: b[3] },
        { x: b[4], y: b[5] }
    ];
    
    // 计算仿射变换矩阵
    const dx1 = dst[1].x - dst[0].x;
    const dy1 = dst[1].y - dst[0].y;
    const dx2 = dst[2].x - dst[0].x;
    const dy2 = dst[2].y - dst[0].y;
    
    const sx1 = src[1].x - src[0].x;
    const sy1 = src[1].y - src[0].y;
    const sx2 = src[2].x - src[0].x;
    const sy2 = src[2].y - src[0].y;
    
    const det = sx1 * sy2 - sx2 * sy1;
    if (Math.abs(det) < 0.0001) {
        return [1, 0, 0, 0, 1, 0, 0, 0];
    }
    
    const a = (dx1 * sy2 - dx2 * sy1) / det;
    const b_val = (dx2 * sx1 - dx1 * sx2) / det;
    const c = (dy1 * sy2 - dy2 * sy1) / det;
    const d = (dy2 * sx1 - dy1 * sx2) / det;
    const e = dst[0].x - a * src[0].x - b_val * src[0].y;
    const f = dst[0].y - c * src[0].x - d * src[0].y;
    
    return [a, b_val, e, c, d, f, 0, 0];
}

// 取消透视变换
function cancelPerspective() {
    perspectivePoints = [];
    drawImage();
}

// 添加文字（已改为点击位置添加，此函数保留用于更新选中文字）
function addTextToCanvas() {
    if (selectedTextIndex >= 0 && textElements[selectedTextIndex]) {
        // 更新选中的文字
        const text = document.getElementById('textContent').value;
        const font = document.getElementById('textFont').value;
        const size = parseInt(document.getElementById('textSize').value);
        const color = document.getElementById('textColor').value;
        
        textElements[selectedTextIndex].text = text;
        textElements[selectedTextIndex].font = font;
        textElements[selectedTextIndex].size = size;
        textElements[selectedTextIndex].color = color;
        drawImage();
    } else {
        // 提示用户点击图片添加文字
        showAlert('请在图片上点击位置添加文字', 'info');
    }
}

// 绘制文字元素
function drawTextElement(elem, index) {
    editorCtx.save();
    editorCtx.font = `${elem.size}px ${elem.font}`;
    editorCtx.fillStyle = elem.color;
    editorCtx.textAlign = 'center';
    editorCtx.textBaseline = 'middle';
    
    // 如果被选中，绘制边框
    if (index === selectedTextIndex) {
        const metrics = editorCtx.measureText(elem.text);
        const textWidth = metrics.width;
        const textHeight = elem.size;
        editorCtx.strokeStyle = '#667eea';
        editorCtx.lineWidth = 2;
        editorCtx.setLineDash([5, 5]);
        editorCtx.strokeRect(
            elem.x - textWidth/2 - 5,
            elem.y - textHeight/2 - 5,
            textWidth + 10,
            textHeight + 10
        );
        editorCtx.setLineDash([]);
    }
    
    editorCtx.fillText(elem.text, elem.x, elem.y);
    editorCtx.restore();
}

// 绘制箭头
function drawArrow(elem) {
    editorCtx.save();
    editorCtx.strokeStyle = elem.color;
    editorCtx.fillStyle = elem.color;
    editorCtx.lineWidth = elem.size;
    editorCtx.lineCap = 'round';
    editorCtx.lineJoin = 'round';
    
    const dx = elem.x2 - elem.x1;
    const dy = elem.y2 - elem.y1;
    const angle = Math.atan2(dy, dx);
    const arrowLength = elem.size * 4;
    const arrowAngle = Math.PI / 6;
    
    if (elem.type === 'simple') {
        // 简单箭头：只有线条和箭头头部
        editorCtx.beginPath();
        editorCtx.moveTo(elem.x1, elem.y1);
        editorCtx.lineTo(elem.x2, elem.y2);
        editorCtx.stroke();
        
        // 箭头头部
        editorCtx.beginPath();
        editorCtx.moveTo(elem.x2, elem.y2);
        editorCtx.lineTo(
            elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
            elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
        );
        editorCtx.moveTo(elem.x2, elem.y2);
        editorCtx.lineTo(
            elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
            elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
        );
        editorCtx.stroke();
    } else if (elem.type === 'filled') {
        // 实心箭头：填充的箭头头部
        editorCtx.beginPath();
        editorCtx.moveTo(elem.x1, elem.y1);
        editorCtx.lineTo(elem.x2, elem.y2);
        editorCtx.stroke();
        
        // 填充的箭头头部
        editorCtx.beginPath();
        editorCtx.moveTo(elem.x2, elem.y2);
        editorCtx.lineTo(
            elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
            elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
        );
        editorCtx.lineTo(
            elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
            elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
        );
        editorCtx.closePath();
        editorCtx.fill();
    } else if (elem.type === 'double') {
        // 双箭头：两端都有箭头
        editorCtx.beginPath();
        editorCtx.moveTo(elem.x1, elem.y1);
        editorCtx.lineTo(elem.x2, elem.y2);
        editorCtx.stroke();
        
        // 起点箭头
        editorCtx.beginPath();
        editorCtx.moveTo(elem.x1, elem.y1);
        editorCtx.lineTo(
            elem.x1 + arrowLength * Math.cos(angle - arrowAngle),
            elem.y1 + arrowLength * Math.sin(angle - arrowAngle)
        );
        editorCtx.moveTo(elem.x1, elem.y1);
        editorCtx.lineTo(
            elem.x1 + arrowLength * Math.cos(angle + arrowAngle),
            elem.y1 + arrowLength * Math.sin(angle + arrowAngle)
        );
        editorCtx.stroke();
        
        // 终点箭头
        editorCtx.beginPath();
        editorCtx.moveTo(elem.x2, elem.y2);
        editorCtx.lineTo(
            elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
            elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
        );
        editorCtx.moveTo(elem.x2, elem.y2);
        editorCtx.lineTo(
            elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
            elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
        );
        editorCtx.stroke();
    }
    
    editorCtx.restore();
}

// 绘制箭头预览
function drawArrowPreview(x1, y1, x2, y2) {
    const type = document.getElementById('arrowType').value;
    const color = toolColors.arrow; // 使用统一的颜色配置
    const size = brushSize; // 使用共享的画笔大小
    drawArrow({ x1, y1, x2, y2, type, color, size });
}

// 优化的箭头预览绘制（使用缓存的基础图像）
function drawArrowPreviewOptimized(x1, y1, x2, y2) {
    if (!editorCtx || !editorCanvas) return;
    
    // 如果缓存不存在，先更新缓存
    if (!cachedBaseImage) {
        // 如果缓存不存在，使用普通绘制方法
        drawImage();
        drawArrowPreview(x1, y1, x2, y2);
        return;
    }
    
    // 使用缓存的基础图像，只绘制预览箭头
    // 注意：cachedBaseImage 已经包含了所有历史箭头，所以这里不需要再绘制历史箭头
    editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    editorCtx.drawImage(cachedBaseImage, 0, 0, editorCanvas.width, editorCanvas.height);
    
    // 绘制选中文字的虚线边框（如果需要）
    if (selectedTextIndex >= 0 && textElements[selectedTextIndex]) {
        const elem = textElements[selectedTextIndex];
        editorCtx.save();
        editorCtx.font = `${elem.size}px ${elem.font}`;
        editorCtx.textAlign = 'center';
        editorCtx.textBaseline = 'middle';
        const metrics = editorCtx.measureText(elem.text);
        const textWidth = metrics.width;
        const textHeight = elem.size;
        editorCtx.strokeStyle = '#667eea';
        editorCtx.lineWidth = 2;
        editorCtx.setLineDash([5, 5]);
        editorCtx.strokeRect(
            elem.x - textWidth / 2 - 5,
            elem.y - textHeight / 2 - 5,
            textWidth + 10,
            textHeight + 10
        );
        editorCtx.setLineDash([]);
        editorCtx.restore();
    }
    
    // 绘制裁剪框（如果正在裁剪）
    if (isCropping) {
        drawCropBox();
    }
    
    // 绘制透视变换点和范围（如果正在变换）
    if (currentTool === 'perspective') {
        perspectivePoints.forEach((point, index) => {
            editorCtx.fillStyle = '#ff0000';
            editorCtx.beginPath();
            editorCtx.arc(point.x, point.y, 8, 0, Math.PI * 2);
            editorCtx.fill();
            editorCtx.strokeStyle = '#ffffff';
            editorCtx.lineWidth = 2;
            editorCtx.stroke();
            
            editorCtx.fillStyle = '#ffffff';
            editorCtx.font = '12px Arial';
            editorCtx.textAlign = 'center';
            editorCtx.fillText((index + 1).toString(), point.x, point.y - 12);
        });
        
        if (perspectivePoints.length === 4) {
            editorCtx.strokeStyle = '#00ff00';
            editorCtx.lineWidth = 2;
            editorCtx.setLineDash([5, 5]);
            editorCtx.beginPath();
            editorCtx.moveTo(perspectivePoints[0].x, perspectivePoints[0].y);
            for (let i = 1; i < 4; i++) {
                editorCtx.lineTo(perspectivePoints[i].x, perspectivePoints[i].y);
            }
            editorCtx.closePath();
            editorCtx.stroke();
            editorCtx.setLineDash([]);
            
            editorCtx.fillStyle = 'rgba(0, 255, 0, 0.1)';
            editorCtx.fill();
        }
    }
    
    // 只绘制预览箭头（不绘制历史箭头，因为历史箭头已经在 cachedBaseImage 中了）
    drawArrowPreview(x1, y1, x2, y2);
}

// 更新画笔大小（从单选框）
// 添加标志位防止循环触发
let isUpdatingBrushSize = false;

function updateBrushSize(size) {
    // 防止循环调用
    if (isUpdatingBrushSize) return;
    
    // 如果大小没有变化，直接返回（但需要确保单选框状态正确）
    if (brushSize === size) {
        // 即使大小相同，也要确保当前工具的单选框状态正确
        const currentToolGroup = document.querySelector(`.size-control-group[data-tool="${currentTool}"]`);
        if (currentToolGroup) {
            const radios = currentToolGroup.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                const radioValue = parseInt(radio.value);
                const label = radio.closest('.size-radio-label');
                if (radioValue === size && !radio.checked) {
                    radio.checked = true;
                    if (label) {
                        label.classList.add('radio-checked');
                    }
                } else if (radio.checked) {
                    radio.checked = false;
                    if (label) {
                        label.classList.remove('radio-checked');
                    }
                }
            });
        }
        return;
    }
    
    isUpdatingBrushSize = true;
    brushSize = size;
    
    // 更新所有输入框的值（两个面板中的）
    const inputs = document.querySelectorAll('.size-input');
    inputs.forEach(input => {
        if (input && input.value !== size.toString()) {
            input.value = size;
        }
    });
    
    // 更新当前工具的单选框状态（只更新当前显示的工具面板）
    const currentToolGroup = document.querySelector(`.size-control-group[data-tool="${currentTool}"]`);
    if (currentToolGroup) {
        const radios = currentToolGroup.querySelectorAll('input[type="radio"]');
        radios.forEach(radio => {
            const radioValue = parseInt(radio.value);
            const label = radio.closest('.size-radio-label');
            if (radioValue === size) {
                if (!radio.checked) {
                    radio.checked = true;
                }
                if (label) {
                    label.classList.add('radio-checked');
                }
            } else {
                if (radio.checked) {
                    radio.checked = false;
                }
                if (label) {
                    label.classList.remove('radio-checked');
                }
            }
        });
    }
    
    isUpdatingBrushSize = false;
    
    // 更新光标样式
    if (currentTool === 'mosaic') {
        updateCursorStyle('mosaic');
    } else if (currentTool === 'arrow') {
        updateCursorStyle('arrow');
    }
    
    // 如果正在绘制箭头，使用优化的预览绘制
    if (currentTool === 'arrow' && isDrawing && drawStartX !== undefined && drawStartY !== undefined) {
        const mouseEvent = window.lastMouseEvent;
        if (mouseEvent && editorCanvas) {
            const rect = editorCanvas.getBoundingClientRect();
            const x = mouseEvent.clientX - rect.left;
            const y = mouseEvent.clientY - rect.top;
            
            // 使用优化的预览绘制，而不是完整的 drawImage
            if (arrowPreviewAnimationFrame) {
                cancelAnimationFrame(arrowPreviewAnimationFrame);
            }
            arrowPreviewAnimationFrame = requestAnimationFrame(() => {
                drawArrowPreviewOptimized(drawStartX, drawStartY, x, y);
                arrowPreviewAnimationFrame = null;
            });
        }
    }
    
    isUpdatingBrushSize = false;
}

// 从输入框更新画笔大小
function updateBrushSizeFromInput() {
    // 防止循环调用
    if (isUpdatingBrushSize) return;
    
        const inputs = document.querySelectorAll('.size-input');
    let inputValue = null;
    
    // 获取当前输入框的值
    inputs.forEach(input => {
        if (input && document.activeElement === input) {
            inputValue = parseInt(input.value) || 10;
        }
    });
    
    // 如果没有找到活动的输入框，使用第一个输入框的值
    if (inputValue === null && inputs.length > 0) {
        inputValue = parseInt(inputs[0].value) || 10;
    }
    
    if (inputValue !== null) {
        const newSize = Math.max(1, Math.min(100, inputValue)); // 限制在1-100之间
        
        // 如果大小没有变化，直接返回
        if (brushSize === newSize) return;
        
        isUpdatingBrushSize = true;
        brushSize = newSize;
        
        // 更新所有输入框的值（同步两个面板）
        inputs.forEach(input => {
            if (input && input.value !== newSize.toString()) {
                input.value = newSize;
            }
        });
        
        // 检查是否匹配预设值，如果匹配则选中对应的单选框（只更新当前工具）
        const currentToolGroup = document.querySelector(`.size-control-group[data-tool="${currentTool}"]`);
        if (currentToolGroup) {
            const radios = currentToolGroup.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                const radioValue = parseInt(radio.value);
                const label = radio.closest('.size-radio-label');
                if (radioValue === newSize) {
                    if (!radio.checked) {
                        radio.checked = true;
                    }
                    if (label) {
                        label.classList.add('radio-checked');
                    }
                } else {
                    if (radio.checked) {
                        radio.checked = false;
                    }
                    if (label) {
                        label.classList.remove('radio-checked');
                    }
                }
            });
        }
        
        // 更新光标样式
        if (currentTool === 'mosaic') {
            updateCursorStyle('mosaic');
        } else if (currentTool === 'arrow') {
            updateCursorStyle('arrow');
        }
        
        // 如果正在绘制箭头，使用优化的预览绘制
        if (currentTool === 'arrow' && isDrawing && drawStartX !== undefined && drawStartY !== undefined) {
            const mouseEvent = window.lastMouseEvent;
            if (mouseEvent && editorCanvas) {
                const rect = editorCanvas.getBoundingClientRect();
                const x = mouseEvent.clientX - rect.left;
                const y = mouseEvent.clientY - rect.top;
                
                // 使用优化的预览绘制，而不是完整的 drawImage
                if (arrowPreviewAnimationFrame) {
                    cancelAnimationFrame(arrowPreviewAnimationFrame);
                }
                arrowPreviewAnimationFrame = requestAnimationFrame(() => {
                    drawArrowPreviewOptimized(drawStartX, drawStartY, x, y);
                    arrowPreviewAnimationFrame = null;
                });
            }
        }
        
        isUpdatingBrushSize = false;
    }
}

// 初始化画笔图层
function initBrushLayer() {
    if (!editorCanvas) return;
    
    // 如果画笔图层不存在或尺寸不匹配，创建新的
    if (!brushLayerCanvas || 
        brushLayerCanvas.width !== editorCanvas.width || 
        brushLayerCanvas.height !== editorCanvas.height) {
        brushLayerCanvas = document.createElement('canvas');
        brushLayerCanvas.width = editorCanvas.width;
        brushLayerCanvas.height = editorCanvas.height;
        brushLayerCtx = brushLayerCanvas.getContext('2d');
    }
}

// 清除画笔图层
function clearBrushLayer() {
    if (brushLayerCanvas && brushLayerCtx) {
        brushLayerCtx.clearRect(0, 0, brushLayerCanvas.width, brushLayerCanvas.height);
    }
}

// 涂抹画笔工具 - 重构版本
let brushRedrawFrame = null; // 用于节流重绘

function applyBrush(x, y) {
    // 确保画笔图层已初始化
    initBrushLayer();
    
    if (!brushLayerCtx || !editorCtx) return;
    
    // 保存上一个点的位置（在更新之前）
    const prevX = lastBrushX;
    const prevY = lastBrushY;
    
    // 1. 在画笔图层上绘制（用于保存）
    brushLayerCtx.save();
    brushLayerCtx.strokeStyle = brushColor;
    brushLayerCtx.fillStyle = brushColor;
    brushLayerCtx.lineWidth = brushSize;
    brushLayerCtx.lineCap = 'round';
    brushLayerCtx.lineJoin = 'round';
    
    if (prevX !== null && prevY !== null) {
        // 绘制线条连接上一个点和当前点
        brushLayerCtx.beginPath();
        brushLayerCtx.moveTo(prevX, prevY);
        brushLayerCtx.lineTo(x, y);
        brushLayerCtx.stroke();
    } else {
        // 第一个点，绘制圆形
        brushLayerCtx.beginPath();
        brushLayerCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        brushLayerCtx.fill();
    }
    brushLayerCtx.restore();
    
    // 2. 先重绘所有历史内容（包括已保存的涂抹、文字、箭头等），然后再绘制当前笔画
    // 这样可以确保所有历史涂抹结果都能显示
    redrawCanvas();
    
    // 更新位置
    lastBrushX = x;
    lastBrushY = y;
}

// 显示文字编辑框
function showTextEditor(index) {
    if (index < 0 || index >= textElements.length) return;
    
    const elem = textElements[index];
    const textInput = document.getElementById('textEditorInput');
    if (!textInput) return;
    
    const canvasRect = editorCanvas.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    
    // 计算文字尺寸
    editorCtx.save();
    editorCtx.font = `${elem.size}px ${elem.font}`;
    editorCtx.textAlign = 'center';
    editorCtx.textBaseline = 'middle';
    const metrics = editorCtx.measureText(elem.text);
    const textWidth = metrics.width;
    const textHeight = elem.size;
    editorCtx.restore();
    
    // 设置输入框位置和样式（考虑滚动位置）
    textInput.style.display = 'block';
    textInput.style.position = 'fixed';
    textInput.style.left = (canvasRect.left + scrollX + elem.x - textWidth/2 - 5) + 'px';
    textInput.style.top = (canvasRect.top + scrollY + elem.y - textHeight/2 - 5) + 'px';
    textInput.style.width = Math.max(100, textWidth + 20) + 'px';
    textInput.style.height = (textHeight + 10) + 'px';
    textInput.style.fontSize = elem.size + 'px';
    textInput.style.fontFamily = elem.font;
    textInput.style.color = elem.color;
    textInput.value = elem.text;
    textInput.focus();
    textInput.select();
    
    // 更新文字内容
    textInput.oninput = () => {
        elem.text = textInput.value;
        // 重新计算宽度
        editorCtx.save();
        editorCtx.font = `${elem.size}px ${elem.font}`;
        const newMetrics = editorCtx.measureText(elem.text);
        textInput.style.width = Math.max(100, newMetrics.width + 20) + 'px';
        editorCtx.restore();
        drawImage();
    };
    
    // 完成编辑
    textInput.onblur = () => {
        finishTextEditing();
    };
}

// 完成文字编辑
function finishTextEditing() {
    const textInput = document.getElementById('textEditorInput');
    if (!textInput) return;
    
    if (editingTextIndex >= 0 && textElements[editingTextIndex]) {
        textElements[editingTextIndex].text = textInput.value;
        // 更新属性面板
        const textContentInput = document.getElementById('textContent');
        if (textContentInput) {
            textContentInput.value = textInput.value;
        }
    }
    textInput.style.display = 'none';
    editingTextIndex = -1;
    drawImage();
    saveHistory();
}

// 重置图像编辑器
function resetImageEditor() {
    try {
        if (!currentImagePath) {
            showAlert('无法重置：图片路径未设置', 'error');
            return;
        }
        if (originalImageFull) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                originalImageFull = img;
                originalImage = img;
            baseImage = img; // 保存基础图像（不包含画笔）
                baseImage = img; // 保存基础图像（不包含画笔）
                
                // 重新计算画布大小
                const maxWidth = window.innerWidth * 0.7;
                const maxHeight = window.innerHeight * 0.7;
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                if (height > maxHeight) {
                    width = (width * maxHeight) / height;
                    height = maxHeight;
                }
                
                scaleX = width / img.width;
                scaleY = height / img.height;
                
                if (editorCanvas) {
                    editorCanvas.width = width;
                    editorCanvas.height = height;
                }
                
                resetEditorState();
                historyStack = [];
                historyIndex = -1;
                saveHistory();
                drawImage();
            };
            img.onerror = () => {
                showAlert('重置失败：无法加载图片', 'error');
            };
            img.src = `/api/preview?path=${encodeURIComponent(currentImagePath)}`;
        } else {
            showAlert('无法重置：图片未加载', 'error');
        }
    } catch (error) {
        console.error('重置图像编辑器时出错:', error);
        showAlert(`重置失败: ${error.message}`, 'error');
    }
}

// 将画笔绘制的内容合并到 originalImage - 重构版本
function mergeBrushToImage() {
    if (!baseImage || !editorCanvas || !editorCtx) return;
    
    // 如果没有画笔图层或画笔图层为空，直接返回
    if (!brushLayerCanvas) return;
    
    // 检查画笔图层是否有内容
    const imageData = brushLayerCtx.getImageData(0, 0, brushLayerCanvas.width, brushLayerCanvas.height);
    const data = imageData.data;
    let hasContent = false;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) { // 检查 alpha 通道
            hasContent = true;
            break;
        }
    }
    
    if (!hasContent) {
        // 没有画笔内容，清除画笔图层并返回
        clearBrushLayer();
        return;
    }
    
    // 创建一个临时 canvas 来保存合并后的图像
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = editorCanvas.width;
    tempCanvas.height = editorCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // 正确的绘制顺序：原图 -> 已保存的画笔 -> 当前画笔图层 -> 文字 -> 箭头
    // 1. 如果 originalImage 包含已保存的画笔内容，直接使用 originalImage 作为基础
    //    否则使用 baseImage
    if (baseImage && originalImage !== baseImage) {
        // originalImage 已经包含了 baseImage + 所有已保存的画笔，直接绘制
        tempCtx.drawImage(originalImage, 0, 0, editorCanvas.width, editorCanvas.height);
    } else {
        // 没有已保存的画笔，从 baseImage 开始
        tempCtx.drawImage(baseImage, 0, 0, editorCanvas.width, editorCanvas.height);
    }
    
    // 2. 绘制当前画笔图层（叠加在已保存的画笔之上）
    tempCtx.drawImage(brushLayerCanvas, 0, 0);
    
    // 4. 绘制文字和箭头（确保它们在画笔内容之上）
    textElements.forEach(elem => {
        tempCtx.save();
        tempCtx.font = `${elem.size}px ${elem.font}`;
        tempCtx.fillStyle = elem.color;
        tempCtx.textAlign = 'center';
        tempCtx.textBaseline = 'middle';
        tempCtx.fillText(elem.text, elem.x, elem.y);
        tempCtx.restore();
    });
    
    arrowElements.forEach(elem => {
        tempCtx.save();
        tempCtx.strokeStyle = elem.color;
        tempCtx.fillStyle = elem.color;
        tempCtx.lineWidth = elem.size;
        tempCtx.lineCap = 'round';
        tempCtx.lineJoin = 'round';
        
        const dx = elem.x2 - elem.x1;
        const dy = elem.y2 - elem.y1;
        const angle = Math.atan2(dy, dx);
        const arrowLength = elem.size * 4;
        const arrowAngle = Math.PI / 6;
        
        tempCtx.beginPath();
        tempCtx.moveTo(elem.x1, elem.y1);
        tempCtx.lineTo(elem.x2, elem.y2);
        tempCtx.stroke();
        
        if (elem.type === 'simple' || elem.type === 'filled') {
            tempCtx.beginPath();
            tempCtx.moveTo(elem.x2, elem.y2);
            tempCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
            );
            tempCtx.moveTo(elem.x2, elem.y2);
            tempCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
            );
            tempCtx.stroke();
            
            if (elem.type === 'filled') {
                tempCtx.beginPath();
                tempCtx.moveTo(elem.x2, elem.y2);
                tempCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                tempCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                tempCtx.closePath();
                tempCtx.fill();
            }
        } else if (elem.type === 'double') {
            tempCtx.beginPath();
            tempCtx.moveTo(elem.x1, elem.y1);
            tempCtx.lineTo(
                elem.x1 + arrowLength * Math.cos(angle - arrowAngle),
                elem.y1 + arrowLength * Math.sin(angle - arrowAngle)
            );
            tempCtx.moveTo(elem.x1, elem.y1);
            tempCtx.lineTo(
                elem.x1 + arrowLength * Math.cos(angle + arrowAngle),
                elem.y1 + arrowLength * Math.sin(angle + arrowAngle)
            );
            tempCtx.stroke();
            
            tempCtx.beginPath();
            tempCtx.moveTo(elem.x2, elem.y2);
            tempCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
            );
            tempCtx.moveTo(elem.x2, elem.y2);
            tempCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
            );
            tempCtx.stroke();
        }
        tempCtx.restore();
    });
    
    // 创建新的 Image 对象（包含画笔）
    const mergedImg = new Image();
    mergedImg.onload = () => {
        originalImage = mergedImg;
        // baseImage 保持不变（不包含画笔）
        // 清除画笔图层
        clearBrushLayer();
        // 重新绘制（确保预览显示合并后的画笔内容）
        // 使用 drawImage 而不是 redrawCanvas，因为 drawImage 会更新缓存并绘制其他元素
        drawImage();
        // 保存历史记录（在合并完成后）
        saveHistory();
    };
    mergedImg.src = tempCanvas.toDataURL();
}

// 同步合并画笔图层（用于工具切换时）
function mergeBrushToImageSync() {
    if (!baseImage || !editorCanvas || !editorCtx || !brushLayerCanvas || !brushLayerCtx) return;
    
    // 检查画笔图层是否有内容
    const imageData = brushLayerCtx.getImageData(0, 0, brushLayerCanvas.width, brushLayerCanvas.height);
    const data = imageData.data;
    let hasContent = false;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
            hasContent = true;
            break;
        }
    }
    
    if (!hasContent) {
        clearBrushLayer();
        return;
    }
    
    // 创建一个临时 canvas 来保存合并后的图像
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = editorCanvas.width;
    tempCanvas.height = editorCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // 正确的绘制顺序：原图 -> 已保存的画笔 -> 当前画笔图层 -> 文字 -> 箭头
    if (baseImage && originalImage !== baseImage) {
        tempCtx.drawImage(originalImage, 0, 0, editorCanvas.width, editorCanvas.height);
    } else {
        tempCtx.drawImage(baseImage, 0, 0, editorCanvas.width, editorCanvas.height);
    }
    
    // 绘制当前画笔图层
    tempCtx.drawImage(brushLayerCanvas, 0, 0);
    
    // 绘制文字和箭头
    textElements.forEach(elem => {
        tempCtx.save();
        tempCtx.font = `${elem.size}px ${elem.font}`;
        tempCtx.fillStyle = elem.color;
        tempCtx.textAlign = 'center';
        tempCtx.textBaseline = 'middle';
        tempCtx.fillText(elem.text, elem.x, elem.y);
        tempCtx.restore();
    });
    
    arrowElements.forEach(elem => {
        tempCtx.save();
        tempCtx.strokeStyle = elem.color;
        tempCtx.fillStyle = elem.color;
        tempCtx.lineWidth = elem.size;
        tempCtx.lineCap = 'round';
        tempCtx.lineJoin = 'round';
        
        const dx = elem.x2 - elem.x1;
        const dy = elem.y2 - elem.y1;
        const angle = Math.atan2(dy, dx);
        const arrowLength = elem.size * 4;
        const arrowAngle = Math.PI / 6;
        
        tempCtx.beginPath();
        tempCtx.moveTo(elem.x1, elem.y1);
        tempCtx.lineTo(elem.x2, elem.y2);
        tempCtx.stroke();
        
        if (elem.type === 'simple' || elem.type === 'filled') {
            tempCtx.beginPath();
            tempCtx.moveTo(elem.x2, elem.y2);
            tempCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
            );
            tempCtx.moveTo(elem.x2, elem.y2);
            tempCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
            );
            tempCtx.stroke();
            
            if (elem.type === 'filled') {
                tempCtx.beginPath();
                tempCtx.moveTo(elem.x2, elem.y2);
                tempCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                tempCtx.lineTo(
                    elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                    elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                tempCtx.closePath();
                tempCtx.fill();
            }
        } else if (elem.type === 'double') {
            tempCtx.beginPath();
            tempCtx.moveTo(elem.x1, elem.y1);
            tempCtx.lineTo(
                elem.x1 + arrowLength * Math.cos(angle - arrowAngle),
                elem.y1 + arrowLength * Math.sin(angle - arrowAngle)
            );
            tempCtx.moveTo(elem.x1, elem.y1);
            tempCtx.lineTo(
                elem.x1 + arrowLength * Math.cos(angle + arrowAngle),
                elem.y1 + arrowLength * Math.sin(angle + arrowAngle)
            );
            tempCtx.stroke();
            
            tempCtx.beginPath();
            tempCtx.moveTo(elem.x2, elem.y2);
            tempCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle - arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle - arrowAngle)
            );
            tempCtx.moveTo(elem.x2, elem.y2);
            tempCtx.lineTo(
                elem.x2 - arrowLength * Math.cos(angle + arrowAngle),
                elem.y2 - arrowLength * Math.sin(angle + arrowAngle)
            );
            tempCtx.stroke();
        }
        tempCtx.restore();
    });
    
    // 同步更新 originalImage（同步方式，不等待异步加载）
    const mergedImg = new Image();
    mergedImg.onload = () => {
        originalImage = mergedImg;
        clearBrushLayer();
        updateCachedBaseImage();
    };
    mergedImg.src = tempCanvas.toDataURL();
    
    // 注意：由于 Image 对象是异步加载的，这里我们等待加载完成
    // 但在工具切换时，我们需要立即更新显示，所以先清除画笔图层
    clearBrushLayer();
}

// 关闭图像编辑器
function closeImageEditor() {
    try {
        const modal = document.getElementById('imageEditorModal');
        if (modal) {
            modal.classList.remove('show');
        }
        // 移除事件监听器
        removeEditorEvents();
        // 重置状态
        resetEditorState();
        // 清理变量
        editorCanvas = null;
        editorCtx = null;
        originalImage = null;
    originalImageFull = null;
    baseImage = null;
    // 清除画笔图层
    clearBrushLayer();
    brushLayerCanvas = null;
    brushLayerCtx = null;
    // 清除画笔图层
    clearBrushLayer();
    brushLayerCanvas = null;
    brushLayerCtx = null;
        currentImagePath = '';
    } catch (error) {
        console.error('关闭图像编辑器时出错:', error);
    }
}

// 保存历史记录
function saveHistory() {
    // 移除当前位置之后的历史记录
    if (historyIndex < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyIndex + 1);
    }
    
    // 保存当前状态
    const state = {
        originalImage: originalImage ? editorCanvas.toDataURL() : null,
        textElements: JSON.parse(JSON.stringify(textElements)),
        arrowElements: JSON.parse(JSON.stringify(arrowElements))
    };
    
    historyStack.push(state);
    historyIndex = historyStack.length - 1;
    
    // 限制历史记录数量
    if (historyStack.length > MAX_EDITOR_HISTORY) {
        historyStack.shift();
        historyIndex--;
    }
}

// 撤销操作
function undoEdit() {
    if (historyIndex > 0) {
        historyIndex--;
        restoreHistory();
    }
}

// 前进操作
function redoEdit() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        restoreHistory();
    }
}

// 恢复历史记录
function restoreHistory() {
    if (historyIndex < 0 || historyIndex >= historyStack.length) return;
    
    const state = historyStack[historyIndex];
    
    // 恢复元素
    textElements = JSON.parse(JSON.stringify(state.textElements));
    arrowElements = JSON.parse(JSON.stringify(state.arrowElements));
    selectedTextIndex = -1;
    editingTextIndex = -1;
    
    // 隐藏文字编辑框
    const textInput = document.getElementById('textEditorInput');
    if (textInput) {
        textInput.style.display = 'none';
    }
    
    // 恢复图片
    if (state.originalImage) {
        const img = new Image();
        img.onload = () => {
            originalImage = img;
            baseImage = img; // 保存基础图像（不包含画笔）
            drawImage();
        };
        img.src = state.originalImage;
    } else {
        // 如果没有保存的图片，重新绘制
        drawImage();
    }
}

// 保存编辑后的图片
async function saveEditedImage() {
    try {
        if (!originalImageFull || !editorCanvas || !originalImage) {
            showAlert('无法保存：图片未加载', 'error');
            return;
        }
        
        // 确保画笔内容已合并
        if (isBrushDrawing || (brushLayerCanvas && brushLayerCtx)) {
            // 检查画笔图层是否有内容
            const imageData = brushLayerCtx.getImageData(0, 0, brushLayerCanvas.width, brushLayerCanvas.height);
            const data = imageData.data;
            let hasBrushContent = false;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 0) {
                    hasBrushContent = true;
                    break;
                }
            }
            if (hasBrushContent) {
                mergeBrushToImage();
                // 等待合并完成（异步操作）
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // 使用原图尺寸保存
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = originalImageFull.width;
        tempCanvas.height = originalImageFull.height;
        
        // 计算缩放因子
        const scaleFactorX = originalImageFull.width / editorCanvas.width;
        const scaleFactorY = originalImageFull.height / editorCanvas.height;
        
        // 创建一个临时 canvas 来组合所有内容
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = editorCanvas.width;
        sourceCanvas.height = editorCanvas.height;
        const sourceCtx = sourceCanvas.getContext('2d');
        
        // 先绘制原图（包含画笔内容）
        sourceCtx.drawImage(originalImage, 0, 0, editorCanvas.width, editorCanvas.height);
        
        // 绘制文字
        textElements.forEach(elem => {
            sourceCtx.save();
            sourceCtx.font = `${elem.size}px ${elem.font}`;
            sourceCtx.fillStyle = elem.color;
            sourceCtx.textAlign = 'center';
            sourceCtx.textBaseline = 'middle';
            sourceCtx.fillText(elem.text, elem.x, elem.y);
            sourceCtx.restore();
        });
        
        // 绘制箭头
        arrowElements.forEach(elem => {
            sourceCtx.save();
            sourceCtx.strokeStyle = elem.color;
            sourceCtx.fillStyle = elem.color;
            sourceCtx.lineWidth = elem.size;
            sourceCtx.lineCap = 'round';
            sourceCtx.lineJoin = 'round';
            
            const dx = elem.x2 - elem.x1;
            const dy = elem.y2 - elem.y1;
            const angle = Math.atan2(dy, dx);
            const arrowLength = elem.size * 4;
            const arrowAngle = Math.PI / 6;
            
            const x1 = elem.x1;
            const y1 = elem.y1;
            const x2 = elem.x2;
            const y2 = elem.y2;
            
            // 绘制箭头线
            sourceCtx.beginPath();
            sourceCtx.moveTo(x1, y1);
            sourceCtx.lineTo(x2, y2);
            sourceCtx.stroke();
            
            // 绘制箭头头部
            if (elem.type === 'simple' || elem.type === 'filled') {
                sourceCtx.beginPath();
                sourceCtx.moveTo(x2, y2);
                sourceCtx.lineTo(
                    x2 - arrowLength * Math.cos(angle - arrowAngle),
                    y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                sourceCtx.moveTo(x2, y2);
                sourceCtx.lineTo(
                    x2 - arrowLength * Math.cos(angle + arrowAngle),
                    y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                sourceCtx.stroke();
                
                if (elem.type === 'filled') {
                    sourceCtx.beginPath();
                    sourceCtx.moveTo(x2, y2);
                    sourceCtx.lineTo(
                        x2 - arrowLength * Math.cos(angle - arrowAngle),
                        y2 - arrowLength * Math.sin(angle - arrowAngle)
                    );
                    sourceCtx.lineTo(
                        x2 - arrowLength * Math.cos(angle + arrowAngle),
                        y2 - arrowLength * Math.sin(angle + arrowAngle)
                    );
                    sourceCtx.closePath();
                    sourceCtx.fill();
                }
            } else if (elem.type === 'double') {
                // 起点箭头
                sourceCtx.beginPath();
                sourceCtx.moveTo(x1, y1);
                sourceCtx.lineTo(
                    x1 + arrowLength * Math.cos(angle - arrowAngle),
                    y1 + arrowLength * Math.sin(angle - arrowAngle)
                );
                sourceCtx.moveTo(x1, y1);
                sourceCtx.lineTo(
                    x1 + arrowLength * Math.cos(angle + arrowAngle),
                    y1 + arrowLength * Math.sin(angle + arrowAngle)
                );
                sourceCtx.stroke();
                
                // 终点箭头
                sourceCtx.beginPath();
                sourceCtx.moveTo(x2, y2);
                sourceCtx.lineTo(
                    x2 - arrowLength * Math.cos(angle - arrowAngle),
                    y2 - arrowLength * Math.sin(angle - arrowAngle)
                );
                sourceCtx.moveTo(x2, y2);
                sourceCtx.lineTo(
                    x2 - arrowLength * Math.cos(angle + arrowAngle),
                    y2 - arrowLength * Math.sin(angle + arrowAngle)
                );
                sourceCtx.stroke();
            }
            sourceCtx.restore();
        });
        
        // 将组合后的内容按原图尺寸缩放绘制到最终 canvas
        tempCtx.drawImage(sourceCanvas, 0, 0, tempCanvas.width, tempCanvas.height);
        
        tempCanvas.toBlob(async (blob) => {
            const formData = new FormData();
            const fileName = currentImagePath.split('/').pop();
            formData.append('file', blob, fileName);
            formData.append('path', currentImagePath);
            
            const response = await fetch('/api/save-edited-image', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                showAlert(data.message || '图片保存成功！', 'success');
                closeImageEditor();
                loadTree();
            } else {
                showAlert(`保存失败: ${data.error}`, 'error');
            }
        }, 'image/png');
    } catch (error) {
        showAlert(`保存失败: ${error.message}`, 'error');
    }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    loadTree();
    loadStats();
    loadServerInfo();
});
