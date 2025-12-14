#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
路径处理工具模块
"""
import os


def get_relative_path(path, upload_folder):
    """获取相对于上传目录的路径"""
    upload_folder = os.path.abspath(upload_folder)
    abs_path = os.path.abspath(path)
    if not abs_path.startswith(upload_folder):
        return None
    return os.path.relpath(abs_path, upload_folder)


