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
            const icon = getFileIcon(item.type, item.ext);
            html += `<span class="tree-icon">${icon}</span>`;
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

// 右键菜单：PDF导出为JPG
function contextMenuPdfToJpg() {
    hideContextMenu();
    if (contextMenuTarget && !contextMenuTarget.isRoot && !contextMenuTarget.isDir) {
        exportPdfToJpg(contextMenuTarget.path);
    }
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
        const icon = result.is_dir ? '📁' : getFileIcon(result.type, result.ext);
        const highlightedName = highlightText(result.name, query);
        const highlightedPath = highlightText(result.path, query);
        
        html += `
            <div class="search-result-item" onclick="navigateToItem('${escapeHtml(result.path)}', ${result.is_dir})">
                <span class="search-result-icon">${icon}</span>
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

// 页面加载时初始化
loadTree();
