#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Web网盘应用
支持文件和文件夹管理功能
"""
import os
import json
import shutil
import re
from datetime import datetime
from flask import Flask, render_template, request, send_file, jsonify
from werkzeug.exceptions import RequestEntityTooLarge
import config

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH
app.config['UPLOAD_FOLDER'] = config.UPLOAD_FOLDER
app.config['SECRET_KEY'] = config.SECRET_KEY

# 确保上传目录存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# 允许的文件扩展名
ALLOWED_EXTENSIONS = config.ALLOWED_EXTENSIONS


def safe_filename(filename):
    """
    安全处理文件名，支持中文
    移除危险字符，但保留中文字符和其他Unicode字符
    """
    if not filename:
        return ''
    
    # 移除路径分隔符和其他危险字符
    # 保留中文字符、字母、数字、点、下划线、连字符、空格等
    # 移除: / \ : * ? " < > | \x00
    filename = re.sub(r'[<>:"/\\|?\x00]', '', filename)
    
    # 移除开头和结尾的空格和点
    filename = filename.strip(' .')
    
    # 如果处理后的文件名为空，返回默认名称
    if not filename:
        return 'unnamed'
    
    # 限制文件名长度（避免过长的文件名）
    if len(filename) > 255:
        name, ext = os.path.splitext(filename)
        filename = name[:255-len(ext)] + ext
    
    return filename


def allowed_file(filename):
    """检查文件扩展名是否允许"""
    if not ALLOWED_EXTENSIONS:
        return True
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_relative_path(path):
    """获取相对于上传目录的路径"""
    upload_folder = os.path.abspath(app.config['UPLOAD_FOLDER'])
    abs_path = os.path.abspath(path)
    if not abs_path.startswith(upload_folder):
        return None
    return os.path.relpath(abs_path, upload_folder)


def get_file_info(filepath, rel_path=''):
    """获取文件信息"""
    stat = os.stat(filepath)
    filename = os.path.basename(filepath)
    ext = os.path.splitext(filename)[1].lower() if '.' in filename else ''
    
    # 判断文件类型
    file_type = 'other'
    if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico']:
        file_type = 'image'
    elif ext in ['.txt', '.md', '.json', '.xml', '.csv', '.log', '.py', '.js', '.html', '.css', '.java', '.cpp', '.c', '.h']:
        file_type = 'text'
    elif ext in ['.pdf']:
        file_type = 'pdf'
    elif ext in ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm']:
        file_type = 'video'
    elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.aac']:
        file_type = 'audio'
    
    return {
        'name': filename,
        'path': rel_path or filename,
        'size': stat.st_size,
        'modified': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
        'size_human': format_size(stat.st_size),
        'type': file_type,
        'ext': ext,
        'is_dir': False
    }


def get_folder_info(folderpath, rel_path=''):
    """获取文件夹信息"""
    stat = os.stat(folderpath)
    foldername = os.path.basename(folderpath)
    
    # 计算文件夹大小
    total_size = 0
    try:
        for dirpath, dirnames, filenames in os.walk(folderpath):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                try:
                    total_size += os.path.getsize(filepath)
                except:
                    pass
    except:
        pass
    
    return {
        'name': foldername,
        'path': rel_path or foldername,
        'size': total_size,
        'modified': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
        'size_human': format_size(total_size),
        'type': 'folder',
        'ext': '',
        'is_dir': True
    }


def format_size(size):
    """格式化文件大小"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} PB"


def build_tree(directory, base_path=''):
    """构建文件树结构"""
    items = []
    
    try:
        entries = sorted(os.listdir(directory), key=str.lower)
        
        for entry in entries:
            entry_path = os.path.join(directory, entry)
            rel_path = os.path.join(base_path, entry) if base_path else entry
            
            # 跳过元数据文件
            if entry.endswith('.meta'):
                continue
            
            # 如果是.trash目录中的文件，尝试读取原始名称
            if base_path == '.trash' or (base_path and base_path.startswith('.trash/')):
                metadata_path = entry_path + '.meta'
                if os.path.exists(metadata_path):
                    try:
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                            original_name = metadata.get('original_name', entry)
                            original_path = metadata.get('original_path', '')
                            
                            if os.path.isdir(entry_path):
                                folder_info = get_folder_info(entry_path, rel_path)
                                folder_info['name'] = original_name  # 使用原始名称
                                folder_info['original_name'] = original_name
                                folder_info['original_path'] = original_path
                                folder_info['undo_id'] = entry
                                folder_info['is_trash'] = True
                                folder_info['children'] = build_tree(entry_path, rel_path)
                                items.append(folder_info)
                            else:
                                file_info = get_file_info(entry_path, rel_path)
                                file_info['name'] = original_name  # 使用原始名称
                                file_info['original_name'] = original_name
                                file_info['original_path'] = original_path
                                file_info['undo_id'] = entry
                                file_info['is_trash'] = True
                                items.append(file_info)
                            continue
                    except:
                        pass
            
            if os.path.isdir(entry_path):
                folder_info = get_folder_info(entry_path, rel_path)
                folder_info['children'] = build_tree(entry_path, rel_path)
                items.append(folder_info)
            else:
                items.append(get_file_info(entry_path, rel_path))
    except Exception as e:
        pass
    
    return items


def get_total_size(directory):
    """计算目录总大小"""
    total = 0
    try:
        for dirpath, dirnames, filenames in os.walk(directory):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                try:
                    total += os.path.getsize(filepath)
                except:
                    pass
    except:
        pass
    return total


@app.route('/')
def index():
    """主页"""
    return render_template('index.html')


@app.route('/api/tree', methods=['GET'])
def get_tree():
    """获取文件树结构"""
    try:
        upload_folder = app.config['UPLOAD_FOLDER']
        tree = build_tree(upload_folder)
        return jsonify({'success': True, 'tree': tree})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/search', methods=['GET'])
def search_files():
    """搜索文件和文件夹"""
    try:
        query = request.args.get('q', '').strip()
        if not query:
            return jsonify({'success': False, 'error': '搜索关键词不能为空'}), 400
        
        upload_folder = app.config['UPLOAD_FOLDER']
        results = []
        
        # 递归搜索文件和文件夹
        def search_in_directory(directory, base_path=''):
            try:
                for entry in os.listdir(directory):
                    entry_path = os.path.join(directory, entry)
                    rel_path = os.path.join(base_path, entry) if base_path else entry
                    
                    # 跳过元数据文件
                    if entry.endswith('.meta'):
                        continue
                    
                    # 处理.trash目录中的文件（显示原始名称）
                    search_name = entry
                    if base_path == '.trash' or (base_path and base_path.startswith('.trash/')):
                        metadata_path = entry_path + '.meta'
                        if os.path.exists(metadata_path):
                            try:
                                with open(metadata_path, 'r', encoding='utf-8') as f:
                                    metadata = json.load(f)
                                    search_name = metadata.get('original_name', entry)
                            except:
                                pass
                    
                    # 检查名称是否匹配
                    if query.lower() in search_name.lower():
                        if os.path.isdir(entry_path):
                            folder_info = get_folder_info(entry_path, rel_path)
                            # 如果是.trash中的文件，使用原始名称
                            if base_path == '.trash' or (base_path and base_path.startswith('.trash/')):
                                metadata_path = entry_path + '.meta'
                                if os.path.exists(metadata_path):
                                    try:
                                        with open(metadata_path, 'r', encoding='utf-8') as f:
                                            metadata = json.load(f)
                                            folder_info['name'] = metadata.get('original_name', entry)
                                            folder_info['original_path'] = metadata.get('original_path', '')
                                            folder_info['is_trash'] = True
                                    except:
                                        pass
                            folder_info['match_type'] = 'folder'
                            results.append(folder_info)
                        else:
                            file_info = get_file_info(entry_path, rel_path)
                            # 如果是.trash中的文件，使用原始名称
                            if base_path == '.trash' or (base_path and base_path.startswith('.trash/')):
                                metadata_path = entry_path + '.meta'
                                if os.path.exists(metadata_path):
                                    try:
                                        with open(metadata_path, 'r', encoding='utf-8') as f:
                                            metadata = json.load(f)
                                            file_info['name'] = metadata.get('original_name', entry)
                                            file_info['original_path'] = metadata.get('original_path', '')
                                            file_info['is_trash'] = True
                                    except:
                                        pass
                            file_info['match_type'] = 'file'
                            results.append(file_info)
                    
                    # 递归搜索子目录（包括.trash目录）
                    if os.path.isdir(entry_path):
                        search_in_directory(entry_path, rel_path)
            except:
                pass
        
        search_in_directory(upload_folder)
        
        # 按名称排序
        results.sort(key=lambda x: x['name'].lower())
        
        return jsonify({
            'success': True,
            'results': results,
            'count': len(results)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """获取存储空间统计"""
    try:
        upload_folder = app.config['UPLOAD_FOLDER']
        total_size = get_total_size(upload_folder)
        return jsonify({
            'success': True,
            'total_size': total_size,
            'total_size_human': format_size(total_size)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/server-info', methods=['GET'])
def get_server_info():
    """获取服务器信息"""
    try:
        import socket
        
        # 获取本机IP地址
        local_ip = 'localhost'
        try:
            # 方法1: 通过连接外部地址获取本机IP
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                # 连接到一个远程地址（不会真正发送数据）
                s.connect(('8.8.8.8', 80))
                local_ip = s.getsockname()[0]
            except Exception:
                # 方法2: 通过主机名获取
                hostname = socket.gethostname()
                local_ip = socket.gethostbyname(hostname)
            finally:
                s.close()
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'local_ip': local_ip,
            'port': config.PORT,
            'url': f'http://{local_ip}:{config.PORT}'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/upload', methods=['POST'])
def upload_file():
    """上传文件"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': '没有选择文件'}), 400
    
    file = request.files['file']
    target_folder = request.form.get('folder', '').strip()
    
    if file.filename == '':
        return jsonify({'success': False, 'error': '文件名不能为空'}), 400
    
    if file and allowed_file(file.filename):
        # 使用支持中文的安全文件名处理
        filename = safe_filename(file.filename)
        
        # 确定目标目录
        if target_folder:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], target_folder)
            # 安全检查
            if not get_relative_path(target_path):
                return jsonify({'success': False, 'error': '无效的文件夹路径'}), 400
            os.makedirs(target_path, exist_ok=True)
            filepath = os.path.join(target_path, filename)
            rel_path = os.path.join(target_folder, filename)
        else:
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            rel_path = filename
        
        # 如果文件已存在，添加时间戳
        if os.path.exists(filepath):
            name, ext = os.path.splitext(filename)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{name}_{timestamp}{ext}"
            if target_folder:
                filepath = os.path.join(target_path, filename)
                rel_path = os.path.join(target_folder, filename)
            else:
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                rel_path = filename
        
        try:
            file.save(filepath)
            file_info = get_file_info(filepath, rel_path)
            return jsonify({
                'success': True,
                'message': '文件上传成功',
                'file': file_info
            })
        except Exception as e:
            return jsonify({'success': False, 'error': f'上传失败: {str(e)}'}), 500
    
    return jsonify({'success': False, 'error': '不允许的文件类型'}), 400


@app.route('/api/create-folder', methods=['POST'])
def create_folder():
    """创建文件夹"""
    try:
        data = request.get_json()
        folder_name = data.get('name', '').strip()
        parent_folder = data.get('parent', '').strip()
        
        if not folder_name:
            return jsonify({'success': False, 'error': '文件夹名称不能为空'}), 400
        
        # 清理文件夹名称（支持中文）
        folder_name = safe_filename(folder_name)
        if not folder_name or folder_name in ['.', '..']:
            return jsonify({'success': False, 'error': '无效的文件夹名称'}), 400
        
        # 确定目标路径
        if parent_folder:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], parent_folder, folder_name)
            rel_path = os.path.join(parent_folder, folder_name)
            # 安全检查
            if not get_relative_path(target_path):
                return jsonify({'success': False, 'error': '无效的父文件夹路径'}), 400
        else:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], folder_name)
            rel_path = folder_name
        
        if os.path.exists(target_path):
            return jsonify({'success': False, 'error': '文件夹已存在'}), 400
        
        os.makedirs(target_path, exist_ok=True)
        folder_info = get_folder_info(target_path, rel_path)
        
        return jsonify({
            'success': True,
            'message': '文件夹创建成功',
            'folder': folder_info
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/rename', methods=['POST'])
def rename_item():
    """重命名文件或文件夹"""
    try:
        data = request.get_json()
        item_path = data.get('path', '').strip()
        new_name = data.get('new_name', '').strip()
        
        if not item_path:
            return jsonify({'success': False, 'error': '路径不能为空'}), 400
        
        if not new_name:
            return jsonify({'success': False, 'error': '新名称不能为空'}), 400
        
        # 清理新名称（支持中文）
        new_name = safe_filename(new_name)
        if not new_name or new_name in ['.', '..']:
            return jsonify({'success': False, 'error': '无效的文件或文件夹名称'}), 400
        
        # 构建源路径
        source_path = os.path.join(app.config['UPLOAD_FOLDER'], item_path)
        if not get_relative_path(source_path):
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        if not os.path.exists(source_path):
            return jsonify({'success': False, 'error': '文件或文件夹不存在'}), 404
        
        # 构建新路径
        parent_dir = os.path.dirname(item_path)
        if parent_dir:
            new_path = os.path.join(parent_dir, new_name)
            new_full_path = os.path.join(app.config['UPLOAD_FOLDER'], new_path)
        else:
            new_path = new_name
            new_full_path = os.path.join(app.config['UPLOAD_FOLDER'], new_path)
        
        # 检查新名称是否已存在
        if os.path.exists(new_full_path):
            return jsonify({'success': False, 'error': '该名称已存在'}), 400
        
        # 重命名
        os.rename(source_path, new_full_path)
        
        # 返回新位置的信息
        if os.path.isdir(new_full_path):
            item_info = get_folder_info(new_full_path, new_path)
        else:
            item_info = get_file_info(new_full_path, new_path)
        
        return jsonify({
            'success': True,
            'message': '重命名成功',
            'item': item_info
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/create-file', methods=['POST'])
def create_file():
    """创建空文件"""
    try:
        data = request.get_json()
        file_name = data.get('name', '').strip()
        parent_folder = data.get('parent', '').strip()
        
        if not file_name:
            return jsonify({'success': False, 'error': '文件名称不能为空'}), 400
        
        # 清理文件名称（支持中文）
        file_name = safe_filename(file_name)
        if not file_name or file_name in ['.', '..']:
            return jsonify({'success': False, 'error': '无效的文件名称'}), 400
        
        # 确定目标路径
        if parent_folder:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], parent_folder, file_name)
            rel_path = os.path.join(parent_folder, file_name)
            # 安全检查
            if not get_relative_path(target_path):
                return jsonify({'success': False, 'error': '无效的父文件夹路径'}), 400
        else:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], file_name)
            rel_path = file_name
        
        if os.path.exists(target_path):
            return jsonify({'success': False, 'error': '文件已存在'}), 400
        
        # 创建空文件
        os.makedirs(os.path.dirname(target_path) if parent_folder else app.config['UPLOAD_FOLDER'], exist_ok=True)
        with open(target_path, 'w', encoding='utf-8') as f:
            f.write('')
        
        file_info = get_file_info(target_path, rel_path)
        
        return jsonify({
            'success': True,
            'message': '文件创建成功',
            'file': file_info
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/move', methods=['POST'])
def move_item():
    """移动文件或文件夹"""
    try:
        data = request.get_json()
        source_path = data.get('source', '').strip()
        target_folder = data.get('target', '').strip()
        
        if not source_path:
            return jsonify({'success': False, 'error': '源路径不能为空'}), 400
        
        # 构建源文件完整路径
        source_full = os.path.join(app.config['UPLOAD_FOLDER'], source_path)
        if not get_relative_path(source_full):
            return jsonify({'success': False, 'error': '无效的源路径'}), 400
        
        if not os.path.exists(source_full):
            return jsonify({'success': False, 'error': '源文件或文件夹不存在'}), 404
        
        item_name = os.path.basename(source_path)
        
        # 构建目标路径
        if target_folder:
            # 安全检查：不能移动到自己的子文件夹中
            if source_path.startswith(target_folder + '/') or source_path == target_folder:
                return jsonify({'success': False, 'error': '不能移动到自己的子文件夹中'}), 400
            
            target_full = os.path.join(app.config['UPLOAD_FOLDER'], target_folder, item_name)
            new_rel_path = os.path.join(target_folder, item_name)
            # 安全检查
            if not get_relative_path(target_full):
                return jsonify({'success': False, 'error': '无效的目标路径'}), 400
            os.makedirs(os.path.join(app.config['UPLOAD_FOLDER'], target_folder), exist_ok=True)
        else:
            target_full = os.path.join(app.config['UPLOAD_FOLDER'], item_name)
            new_rel_path = item_name
        
        if os.path.exists(target_full):
            return jsonify({'success': False, 'error': '目标位置已存在同名文件或文件夹'}), 400
        
        # 移动文件或文件夹
        shutil.move(source_full, target_full)
        
        # 返回新位置的信息
        if os.path.isdir(target_full):
            item_info = get_folder_info(target_full, new_rel_path)
        else:
            item_info = get_file_info(target_full, new_rel_path)
        
        return jsonify({
            'success': True,
            'message': '移动成功',
            'item': item_info
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/download', methods=['GET'])
def download_file():
    """下载文件"""
    try:
        file_path = request.args.get('path', '')
        if not file_path:
            return jsonify({'success': False, 'error': '文件路径不能为空'}), 400
        
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file_path)
        
        # 安全检查
        if not get_relative_path(filepath):
            return jsonify({'success': False, 'error': '无效的文件路径'}), 400
        
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            return jsonify({'success': False, 'error': '文件不存在'}), 404
        
        filename = os.path.basename(filepath)
        # 使用原始文件名，支持中文
        from urllib.parse import quote
        response = send_file(
            filepath,
            as_attachment=True,
            download_name=filename
        )
        # 确保中文文件名正确显示（使用RFC 5987标准）
        if any(ord(c) > 127 for c in filename):
            encoded_filename = quote(filename.encode('utf-8'))
            response.headers['Content-Disposition'] = f'attachment; filename="{filename}"; filename*=UTF-8\'\'{encoded_filename}'
        return response
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/preview', methods=['GET'])
def preview_file():
    """预览文件"""
    try:
        file_path = request.args.get('path', '')
        if not file_path:
            return jsonify({'success': False, 'error': '文件路径不能为空'}), 400
        
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file_path)
        
        # 安全检查
        if not get_relative_path(filepath):
            return jsonify({'success': False, 'error': '无效的文件路径'}), 400
        
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            return jsonify({'success': False, 'error': '文件不存在'}), 404
        
        file_info = get_file_info(filepath, file_path)
        ext = file_info['ext'].lower()
        
        # 图片文件直接返回
        if file_info['type'] == 'image':
            return send_file(filepath, mimetype=f'image/{ext[1:]}')
        
        # 文本文件返回内容
        elif file_info['type'] == 'text':
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                return jsonify({
                    'success': True,
                    'type': 'text',
                    'content': content,
                    'filename': file_info['name']
                })
            except UnicodeDecodeError:
                try:
                    with open(filepath, 'r', encoding='gbk') as f:
                        content = f.read()
                    return jsonify({
                        'success': True,
                        'type': 'text',
                        'content': content,
                        'filename': file_info['name']
                    })
                except:
                    return jsonify({
                        'success': False,
                        'error': '无法读取文件内容（可能是二进制文件）'
                    }), 400
        
        # PDF文件
        elif file_info['type'] == 'pdf':
            return send_file(filepath, mimetype='application/pdf')
        
        # 视频文件
        elif file_info['type'] == 'video':
            return send_file(filepath, mimetype=f'video/{ext[1:]}')
        
        # 音频文件
        elif file_info['type'] == 'audio':
            return send_file(filepath, mimetype=f'audio/{ext[1:]}')
        
        else:
            return jsonify({
                'success': False,
                'error': '该文件类型不支持预览'
            }), 400
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/delete', methods=['DELETE'])
def delete_item():
    """删除文件或文件夹"""
    try:
        data = request.get_json()
        item_path = data.get('path', '')
        
        if not item_path:
            return jsonify({'success': False, 'error': '路径不能为空'}), 400
        
        itempath = os.path.join(app.config['UPLOAD_FOLDER'], item_path)
        
        # 安全检查
        if not get_relative_path(itempath):
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        if not os.path.exists(itempath):
            return jsonify({'success': False, 'error': '文件或文件夹不存在'}), 404
        
        # 获取删除前的信息（用于撤销）
        is_dir = os.path.isdir(itempath)
        if is_dir:
            item_info = get_folder_info(itempath, item_path)
        else:
            item_info = get_file_info(itempath, item_path)
        
        # 移动到临时目录（用于撤销）
        temp_dir = os.path.join(app.config['UPLOAD_FOLDER'], '.trash')
        os.makedirs(temp_dir, exist_ok=True)
        
        # 生成唯一ID用于撤销
        import uuid
        undo_id = str(uuid.uuid4())
        temp_path = os.path.join(temp_dir, undo_id)
        
        # 保存原始信息到元数据文件
        metadata = {
            'original_path': item_path,
            'original_name': item_info['name'],
            'is_dir': is_dir,
            'deleted_at': datetime.now().isoformat()
        }
        metadata_path = os.path.join(temp_dir, undo_id + '.meta')
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False)
        
        # 移动而不是删除
        shutil.move(itempath, temp_path)
        
        return jsonify({
            'success': True, 
            'message': '删除成功',
            'undo_id': undo_id,
            'item': item_info
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/restore', methods=['POST'])
def restore_item():
    """恢复文件或文件夹"""
    try:
        data = request.get_json()
        undo_id = data.get('undo_id', '')
        
        if not undo_id:
            return jsonify({'success': False, 'error': '参数不完整'}), 400
        
        temp_dir = os.path.join(app.config['UPLOAD_FOLDER'], '.trash')
        temp_path = os.path.join(temp_dir, undo_id)
        metadata_path = os.path.join(temp_dir, undo_id + '.meta')
        
        if not os.path.exists(temp_path):
            return jsonify({'success': False, 'error': '文件不存在'}), 404
        
        # 读取元数据
        if not os.path.exists(metadata_path):
            return jsonify({'success': False, 'error': '元数据文件不存在'}), 404
        
        with open(metadata_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        original_path = metadata.get('original_path', '')
        if not original_path:
            return jsonify({'success': False, 'error': '原始路径信息缺失'}), 400
        
        # 恢复文件
        restore_path = os.path.join(app.config['UPLOAD_FOLDER'], original_path)
        
        # 确保父目录存在
        parent_dir = os.path.dirname(restore_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        
        if os.path.exists(restore_path):
            return jsonify({'success': False, 'error': '目标位置已存在同名文件或文件夹'}), 400
        
        shutil.move(temp_path, restore_path)
        # 删除元数据文件
        if os.path.exists(metadata_path):
            os.remove(metadata_path)
        
        # 返回恢复后的信息
        if os.path.isdir(restore_path):
            item_info = get_folder_info(restore_path, original_path)
        else:
            item_info = get_file_info(restore_path, original_path)
        
        return jsonify({
            'success': True,
            'message': '恢复成功',
            'item': item_info
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/restore-all', methods=['POST'])
def restore_all():
    """恢复回收站中的所有文件"""
    try:
        temp_dir = os.path.join(app.config['UPLOAD_FOLDER'], '.trash')
        if not os.path.exists(temp_dir):
            return jsonify({'success': True, 'message': '回收站为空', 'restored_count': 0})
        
        restored_count = 0
        failed_count = 0
        
        # 遍历回收站中的所有文件
        for entry in os.listdir(temp_dir):
            if entry.endswith('.meta'):
                continue
            
            entry_path = os.path.join(temp_dir, entry)
            metadata_path = entry_path + '.meta'
            
            if not os.path.exists(metadata_path):
                continue
            
            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                original_path = metadata.get('original_path', '')
                if not original_path:
                    continue
                
                restore_path = os.path.join(app.config['UPLOAD_FOLDER'], original_path)
                
                # 如果目标位置已存在，跳过
                if os.path.exists(restore_path):
                    failed_count += 1
                    continue
                
                # 确保父目录存在
                parent_dir = os.path.dirname(restore_path)
                if parent_dir:
                    os.makedirs(parent_dir, exist_ok=True)
                
                shutil.move(entry_path, restore_path)
                os.remove(metadata_path)
                restored_count += 1
            except Exception as e:
                failed_count += 1
                continue
        
        return jsonify({
            'success': True,
            'message': f'成功恢复 {restored_count} 个项目',
            'restored_count': restored_count,
            'failed_count': failed_count
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/empty-trash', methods=['POST'])
def empty_trash():
    """清空回收站"""
    try:
        temp_dir = os.path.join(app.config['UPLOAD_FOLDER'], '.trash')
        if not os.path.exists(temp_dir):
            return jsonify({'success': True, 'message': '回收站已为空'})
        
        deleted_count = 0
        for entry in os.listdir(temp_dir):
            entry_path = os.path.join(temp_dir, entry)
            try:
                if os.path.isdir(entry_path):
                    shutil.rmtree(entry_path)
                else:
                    os.remove(entry_path)
                deleted_count += 1
            except:
                pass
        
        return jsonify({
            'success': True,
            'message': f'已清空回收站，删除了 {deleted_count} 个项目',
            'deleted_count': deleted_count
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/permanent-delete', methods=['DELETE'])
def permanent_delete():
    """永久删除回收站中的文件"""
    try:
        data = request.get_json()
        undo_id = data.get('undo_id', '')
        
        if not undo_id:
            return jsonify({'success': False, 'error': '参数不完整'}), 400
        
        temp_dir = os.path.join(app.config['UPLOAD_FOLDER'], '.trash')
        temp_path = os.path.join(temp_dir, undo_id)
        metadata_path = os.path.join(temp_dir, undo_id + '.meta')
        
        if not os.path.exists(temp_path):
            return jsonify({'success': False, 'error': '文件不存在'}), 404
        
        # 永久删除
        if os.path.isdir(temp_path):
            shutil.rmtree(temp_path)
        else:
            os.remove(temp_path)
        
        # 删除元数据文件
        if os.path.exists(metadata_path):
            os.remove(metadata_path)
        
        return jsonify({'success': True, 'message': '永久删除成功'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/undo-delete', methods=['POST'])
def undo_delete():
    """撤销删除操作（兼容旧版本）"""
    try:
        data = request.get_json()
        undo_id = data.get('undo_id', '')
        original_path = data.get('original_path', '')
        
        if not undo_id:
            return jsonify({'success': False, 'error': '参数不完整'}), 400
        
        # 尝试使用新的恢复API
        return restore_item()
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    """处理文件过大错误"""
    max_size_mb = config.MAX_CONTENT_LENGTH / (1024 * 1024)
    max_size_gb = config.MAX_CONTENT_LENGTH / (1024 * 1024 * 1024)
    if max_size_gb >= 1:
        size_str = f"{max_size_gb:.0f}GB"
    else:
        size_str = f"{max_size_mb:.0f}MB"
    return jsonify({'success': False, 'error': f'文件大小超过限制（最大{size_str}）'}), 413


@app.errorhandler(404)
def not_found(e):
    """处理404错误"""
    return jsonify({'success': False, 'error': '页面不存在'}), 404


@app.errorhandler(500)
def internal_error(e):
    """处理500错误"""
    return jsonify({'success': False, 'error': '服务器内部错误'}), 500


if __name__ == '__main__':
    import socket
    
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
    except:
        local_ip = 'localhost'
    
    print(f"""
    ========================================
    Web网盘服务已启动
    ========================================
    本地访问: http://127.0.0.1:{config.PORT}
    局域网访问: http://{local_ip}:{config.PORT}
    上传目录: {config.UPLOAD_FOLDER}
    最大文件大小: {config.MAX_CONTENT_LENGTH / (1024 * 1024 * 1024):.0f}GB
    调试模式: {config.DEBUG}
    ========================================
    """)
    
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
