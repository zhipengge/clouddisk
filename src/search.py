#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件搜索模块
"""
import os
import json
from .file_info import get_file_info, get_folder_info


def search_files(upload_folder, query):
    """搜索文件和文件夹"""
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
    
    return results

