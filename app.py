#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Web网盘应用
支持文件和文件夹管理功能
"""
import os
import json
import shutil
import uuid
import socket
from datetime import datetime
from flask import Flask, render_template, request, send_file, jsonify
from werkzeug.exceptions import RequestEntityTooLarge
from urllib.parse import quote
import config

# 导入自定义模块
from src import utils, path_utils, file_info, file_tree, search

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH
app.config['UPLOAD_FOLDER'] = config.UPLOAD_FOLDER
app.config['SECRET_KEY'] = config.SECRET_KEY

# 确保上传目录存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)


# ==================== 路由处理 ====================

@app.route('/')
def index():
    """主页"""
    return render_template('index.html')


@app.route('/api/tree', methods=['GET'])
def get_tree():
    """获取文件树结构"""
    try:
        upload_folder = app.config['UPLOAD_FOLDER']
        tree = file_tree.build_tree(upload_folder)
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
        results = search.search_files(upload_folder, query)
        
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
        total_size = utils.get_total_size(upload_folder)
        return jsonify({
            'success': True,
            'total_size': total_size,
            'total_size_human': utils.format_size(total_size)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/server-info', methods=['GET'])
def get_server_info():
    """获取服务器信息"""
    try:
        # 获取本机IP地址
        local_ip = 'localhost'
        try:
            # 方法1: 通过连接外部地址获取本机IP
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
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
    
    if file and utils.allowed_file(file.filename):
        filename = utils.safe_filename(file.filename)
        
        # 确定目标目录
        if target_folder:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], target_folder)
            if not path_utils.get_relative_path(target_path, app.config['UPLOAD_FOLDER']):
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
            file_info_data = file_info.get_file_info(filepath, rel_path)
            return jsonify({
                'success': True,
                'message': '文件上传成功',
                'file': file_info_data
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
        
        folder_name = utils.safe_filename(folder_name)
        if not folder_name or folder_name in ['.', '..']:
            return jsonify({'success': False, 'error': '无效的文件夹名称'}), 400
        
        # 确定目标路径
        if parent_folder:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], parent_folder, folder_name)
            rel_path = os.path.join(parent_folder, folder_name)
            if not path_utils.get_relative_path(target_path, app.config['UPLOAD_FOLDER']):
                return jsonify({'success': False, 'error': '无效的父文件夹路径'}), 400
        else:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], folder_name)
            rel_path = folder_name
        
        if os.path.exists(target_path):
            return jsonify({'success': False, 'error': '文件夹已存在'}), 400
        
        os.makedirs(target_path, exist_ok=True)
        folder_info_data = file_info.get_folder_info(target_path, rel_path)
        
        return jsonify({
            'success': True,
            'message': '文件夹创建成功',
            'folder': folder_info_data
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
        
        new_name = utils.safe_filename(new_name)
        if not new_name or new_name in ['.', '..']:
            return jsonify({'success': False, 'error': '无效的文件或文件夹名称'}), 400
        
        source_path = os.path.join(app.config['UPLOAD_FOLDER'], item_path)
        if not path_utils.get_relative_path(source_path, app.config['UPLOAD_FOLDER']):
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
        
        if os.path.exists(new_full_path):
            return jsonify({'success': False, 'error': '该名称已存在'}), 400
        
        os.rename(source_path, new_full_path)
        
        if os.path.isdir(new_full_path):
            item_info_data = file_info.get_folder_info(new_full_path, new_path)
        else:
            item_info_data = file_info.get_file_info(new_full_path, new_path)
        
        return jsonify({
            'success': True,
            'message': '重命名成功',
            'item': item_info_data
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
        
        file_name = utils.safe_filename(file_name)
        if not file_name or file_name in ['.', '..']:
            return jsonify({'success': False, 'error': '无效的文件名称'}), 400
        
        if parent_folder:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], parent_folder, file_name)
            rel_path = os.path.join(parent_folder, file_name)
            if not path_utils.get_relative_path(target_path, app.config['UPLOAD_FOLDER']):
                return jsonify({'success': False, 'error': '无效的父文件夹路径'}), 400
        else:
            target_path = os.path.join(app.config['UPLOAD_FOLDER'], file_name)
            rel_path = file_name
        
        if os.path.exists(target_path):
            return jsonify({'success': False, 'error': '文件已存在'}), 400
        
        os.makedirs(os.path.dirname(target_path) if parent_folder else app.config['UPLOAD_FOLDER'], exist_ok=True)
        with open(target_path, 'w', encoding='utf-8') as f:
            f.write('')
        
        file_info_data = file_info.get_file_info(target_path, rel_path)
        
        return jsonify({
            'success': True,
            'message': '文件创建成功',
            'file': file_info_data
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
        
        source_full = os.path.join(app.config['UPLOAD_FOLDER'], source_path)
        if not path_utils.get_relative_path(source_full, app.config['UPLOAD_FOLDER']):
            return jsonify({'success': False, 'error': '无效的源路径'}), 400
        
        if not os.path.exists(source_full):
            return jsonify({'success': False, 'error': '源文件或文件夹不存在'}), 404
        
        item_name = os.path.basename(source_path)
        
        if target_folder:
            if source_path.startswith(target_folder + '/') or source_path == target_folder:
                return jsonify({'success': False, 'error': '不能移动到自己的子文件夹中'}), 400
            
            target_full = os.path.join(app.config['UPLOAD_FOLDER'], target_folder, item_name)
            new_rel_path = os.path.join(target_folder, item_name)
            if not path_utils.get_relative_path(target_full, app.config['UPLOAD_FOLDER']):
                return jsonify({'success': False, 'error': '无效的目标路径'}), 400
            os.makedirs(os.path.join(app.config['UPLOAD_FOLDER'], target_folder), exist_ok=True)
        else:
            target_full = os.path.join(app.config['UPLOAD_FOLDER'], item_name)
            new_rel_path = item_name
        
        if os.path.exists(target_full):
            return jsonify({'success': False, 'error': '目标位置已存在同名文件或文件夹'}), 400
        
        shutil.move(source_full, target_full)
        
        if os.path.isdir(target_full):
            item_info_data = file_info.get_folder_info(target_full, new_rel_path)
        else:
            item_info_data = file_info.get_file_info(target_full, new_rel_path)
        
        return jsonify({
            'success': True,
            'message': '移动成功',
            'item': item_info_data
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
        
        if not path_utils.get_relative_path(filepath, app.config['UPLOAD_FOLDER']):
            return jsonify({'success': False, 'error': '无效的文件路径'}), 400
        
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            return jsonify({'success': False, 'error': '文件不存在'}), 404
        
        filename = os.path.basename(filepath)
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
        
        if not path_utils.get_relative_path(filepath, app.config['UPLOAD_FOLDER']):
            return jsonify({'success': False, 'error': '无效的文件路径'}), 400
        
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            return jsonify({'success': False, 'error': '文件不存在'}), 404
        
        file_info_data = file_info.get_file_info(filepath, file_path)
        ext = file_info_data['ext'].lower()
        
        if file_info_data['type'] == 'image':
            return send_file(filepath, mimetype=f'image/{ext[1:]}')
        elif file_info_data['type'] == 'text':
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                return jsonify({
                    'success': True,
                    'type': 'text',
                    'content': content,
                    'filename': file_info_data['name']
                })
            except UnicodeDecodeError:
                try:
                    with open(filepath, 'r', encoding='gbk') as f:
                        content = f.read()
                    return jsonify({
                        'success': True,
                        'type': 'text',
                        'content': content,
                        'filename': file_info_data['name']
                    })
                except:
                    return jsonify({
                        'success': False,
                        'error': '无法读取文件内容（可能是二进制文件）'
                    }), 400
        elif file_info_data['type'] == 'pdf':
            return send_file(filepath, mimetype='application/pdf')
        elif file_info_data['type'] == 'video':
            return send_file(filepath, mimetype=f'video/{ext[1:]}')
        elif file_info_data['type'] == 'audio':
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
        
        if not path_utils.get_relative_path(itempath, app.config['UPLOAD_FOLDER']):
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        if not os.path.exists(itempath):
            return jsonify({'success': False, 'error': '文件或文件夹不存在'}), 404
        
        is_dir = os.path.isdir(itempath)
        if is_dir:
            item_info_data = file_info.get_folder_info(itempath, item_path)
        else:
            item_info_data = file_info.get_file_info(itempath, item_path)
        
        # 移动到临时目录（用于撤销）
        temp_dir = os.path.join(app.config['UPLOAD_FOLDER'], '.trash')
        os.makedirs(temp_dir, exist_ok=True)
        
        undo_id = str(uuid.uuid4())
        temp_path = os.path.join(temp_dir, undo_id)
        
        # 保存原始信息到元数据文件
        metadata = {
            'original_path': item_path,
            'original_name': item_info_data['name'],
            'is_dir': is_dir,
            'deleted_at': datetime.now().isoformat()
        }
        metadata_path = os.path.join(temp_dir, undo_id + '.meta')
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False)
        
        shutil.move(itempath, temp_path)
        
        return jsonify({
            'success': True, 
            'message': '删除成功',
            'undo_id': undo_id,
            'item': item_info_data
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
        
        if not os.path.exists(metadata_path):
            return jsonify({'success': False, 'error': '元数据文件不存在'}), 404
        
        with open(metadata_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        original_path = metadata.get('original_path', '')
        if not original_path:
            return jsonify({'success': False, 'error': '原始路径信息缺失'}), 400
        
        restore_path = os.path.join(app.config['UPLOAD_FOLDER'], original_path)
        
        parent_dir = os.path.dirname(restore_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        
        if os.path.exists(restore_path):
            return jsonify({'success': False, 'error': '目标位置已存在同名文件或文件夹'}), 400
        
        shutil.move(temp_path, restore_path)
        if os.path.exists(metadata_path):
            os.remove(metadata_path)
        
        if os.path.isdir(restore_path):
            item_info_data = file_info.get_folder_info(restore_path, original_path)
        else:
            item_info_data = file_info.get_file_info(restore_path, original_path)
        
        return jsonify({
            'success': True,
            'message': '恢复成功',
            'item': item_info_data
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
                
                if os.path.exists(restore_path):
                    failed_count += 1
                    continue
                
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
        
        if os.path.isdir(temp_path):
            shutil.rmtree(temp_path)
        else:
            os.remove(temp_path)
        
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
        
        if not undo_id:
            return jsonify({'success': False, 'error': '参数不完整'}), 400
        
        return restore_item()
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== 错误处理 ====================

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


# ==================== 主程序入口 ====================

if __name__ == '__main__':
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
