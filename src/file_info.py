#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件信息模块
"""
import os
from datetime import datetime
from .utils import format_size


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

