#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
工具函数模块
"""
import os
import re
import config


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
    if not config.ALLOWED_EXTENSIONS:
        return True
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in config.ALLOWED_EXTENSIONS


def format_size(size):
    """格式化文件大小"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} PB"


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

