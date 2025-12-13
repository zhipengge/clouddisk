#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件树构建模块
"""
import os
import json
from .file_info import get_file_info, get_folder_info


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

