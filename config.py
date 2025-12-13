#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
配置文件
用于管理应用的各项配置参数
"""

# 服务器配置
HOST = '0.0.0.0'  # 监听所有网络接口，支持局域网访问
PORT = 8000       # 服务端口
DEBUG = True      # 调试模式，生产环境建议设置为False

# 文件管理配置
UPLOAD_FOLDER = 'uploads'  # 文件上传目录
MAX_CONTENT_LENGTH = 1024 * 1024 * 1024  # 最大上传文件大小（字节），默认1GB
# 例如：100MB = 100 * 1024 * 1024
# 例如：500MB = 500 * 1024 * 1024
# 例如：2GB = 2 * 1024 * 1024 * 1024

# 安全配置
SECRET_KEY = 'your-secret-key-here-change-in-production'  # Flask会话密钥，生产环境请修改

# 文件类型限制
# 空集合表示允许所有文件类型
# 如果需要限制文件类型，可以设置为：ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx'}
ALLOWED_EXTENSIONS = set()

