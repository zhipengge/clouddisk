#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF工具模块
处理PDF转JPG等功能
"""
import os
import zipfile
import tempfile
import shutil
from pdf2image import convert_from_path
from PIL import Image


def find_poppler_path():
    """
    查找poppler的安装路径
    
    Returns:
        str: poppler的bin目录路径，如果找不到返回None
    """
    # 常见的poppler安装路径
    possible_paths = [
        '/opt/homebrew/bin',  # Apple Silicon Mac (Homebrew)
        '/usr/local/bin',     # Intel Mac (Homebrew)
        '/usr/bin',           # Linux系统路径
        '/opt/local/bin',     # MacPorts
        '/opt/homebrew/opt/poppler/bin',  # Homebrew poppler 特定路径
        '/usr/local/opt/poppler/bin',     # Homebrew poppler 特定路径 (Intel)
    ]
    
    # 检查PATH环境变量中的路径
    path_env = os.environ.get('PATH', '')
    if path_env:
        possible_paths.extend(path_env.split(os.pathsep))
    
    # 去重并保持顺序
    seen = set()
    unique_paths = []
    for path in possible_paths:
        if path and path not in seen:
            seen.add(path)
            unique_paths.append(path)
    
    # 查找pdftoppm命令
    for path in unique_paths:
        pdftoppm_path = os.path.join(path, 'pdftoppm')
        if os.path.exists(pdftoppm_path) and os.access(pdftoppm_path, os.X_OK):
            return path
    
    # 尝试使用which命令查找
    try:
        pdftoppm_path = shutil.which('pdftoppm')
        if pdftoppm_path:
            return os.path.dirname(pdftoppm_path)
    except:
        pass
    
    # 尝试查找 Homebrew Cellar 中的 poppler
    try:
        import platform
        if platform.system() == 'Darwin':  # macOS
            # 检查 Homebrew Cellar
            homebrew_prefixes = ['/opt/homebrew', '/usr/local']
            for prefix in homebrew_prefixes:
                cellar_path = os.path.join(prefix, 'Cellar', 'poppler')
                if os.path.exists(cellar_path):
                    # 查找最新版本
                    versions = [d for d in os.listdir(cellar_path) 
                               if os.path.isdir(os.path.join(cellar_path, d))]
                    if versions:
                        # 按版本号排序，取最新的
                        versions.sort(reverse=True)
                        latest_version = versions[0]
                        bin_path = os.path.join(cellar_path, latest_version, 'bin')
                        pdftoppm_path = os.path.join(bin_path, 'pdftoppm')
                        if os.path.exists(pdftoppm_path):
                            return bin_path
    except:
        pass
    
    return None


def pdf_to_jpg_zip(pdf_path, output_zip_path=None, dpi=200):
    """
    将PDF文件转换为JPG图片并打包为ZIP文件
    
    Args:
        pdf_path: PDF文件路径
        output_zip_path: 输出ZIP文件路径，如果为None则自动生成
        dpi: 图片分辨率，默认200
    
    Returns:
        str: ZIP文件路径
    
    Raises:
        Exception: 转换失败时抛出异常
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF文件不存在: {pdf_path}")
    
    if not pdf_path.lower().endswith('.pdf'):
        raise ValueError("文件不是PDF格式")
    
    # 如果没有指定输出路径，使用临时目录
    if output_zip_path is None:
        temp_dir = tempfile.gettempdir()
        pdf_name = os.path.splitext(os.path.basename(pdf_path))[0]
        output_zip_path = os.path.join(temp_dir, f"{pdf_name}_images.zip")
    
    # 确保输出目录存在
    output_dir = os.path.dirname(output_zip_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    try:
        # 查找poppler路径
        poppler_path = find_poppler_path()
        
        # 将PDF转换为图片
        if poppler_path:
            images = convert_from_path(pdf_path, dpi=dpi, poppler_path=poppler_path)
        else:
            # 尝试不使用路径（如果poppler在系统PATH中）
            try:
                images = convert_from_path(pdf_path, dpi=dpi)
            except Exception as e:
                error_msg = str(e)
                if 'poppler' in error_msg.lower() or 'PATH' in error_msg:
                    # 提供详细的安装说明和诊断信息
                    import platform
                    system = platform.system()
                    install_cmd = ""
                    verify_cmd = ""
                    conda_cmd = ""
                    
                    # 检查当前PATH
                    current_path = os.environ.get('PATH', '')
                    path_info = f"当前PATH: {current_path[:100]}..." if len(current_path) > 100 else f"当前PATH: {current_path}"
                    
                    if system == 'Darwin':  # macOS
                        install_cmd = "brew install poppler"
                        verify_cmd = "brew list poppler && which pdftoppm"
                        conda_cmd = "conda install -c conda-forge poppler"
                    elif system == 'Linux':
                        install_cmd = "sudo apt-get install poppler-utils"
                        verify_cmd = "dpkg -l | grep poppler"
                        conda_cmd = "conda install -c conda-forge poppler"
                    else:  # Windows
                        install_cmd = "下载并安装 poppler for Windows: http://blog.alivate.com.au/poppler-windows/"
                        verify_cmd = "检查 poppler 是否在 PATH 中"
                        conda_cmd = "conda install -c conda-forge poppler"
                    
                    # 检查是否在conda环境中
                    conda_env = os.environ.get('CONDA_DEFAULT_ENV', '')
                    conda_info = f"\n检测到conda环境: {conda_env}" if conda_env else "\n未检测到conda环境"
                    
                    raise Exception(
                        "未找到poppler工具。\n\n"
                        f"{path_info}{conda_info}\n\n"
                        "安装步骤（选择一种方式）：\n"
                        f"  方式1 - Homebrew (推荐):\n"
                        f"    {install_cmd}\n"
                        f"    验证: {verify_cmd}\n\n"
                        f"  方式2 - Conda (如果使用conda环境):\n"
                        f"    {conda_cmd}\n"
                        f"    验证: conda list poppler\n\n"
                        "安装后：\n"
                        "  1. 如果使用pipenv，请确保在pipenv环境中运行应用\n"
                        "  2. 安装后必须重启应用才能生效\n"
                        "  3. 如果仍无法找到，请检查PATH环境变量\n\n"
                        f"原始错误: {error_msg}"
                    )
                raise
        
        # 创建ZIP文件
        with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for i, image in enumerate(images, start=1):
                # 将图片保存为临时文件
                temp_img_path = tempfile.NamedTemporaryFile(
                    suffix='.jpg', 
                    delete=False
                )
                try:
                    # 转换为RGB模式（确保兼容性）
                    if image.mode != 'RGB':
                        image = image.convert('RGB')
                    
                    # 保存为JPG
                    image.save(temp_img_path.name, 'JPEG', quality=95)
                    
                    # 添加到ZIP文件
                    zip_name = f"page_{i:04d}.jpg"
                    zipf.write(temp_img_path.name, zip_name)
                finally:
                    # 删除临时图片文件
                    if os.path.exists(temp_img_path.name):
                        os.unlink(temp_img_path.name)
        
        return output_zip_path
    
    except Exception as e:
        # 如果出错，清理可能已创建的文件
        if os.path.exists(output_zip_path):
            try:
                os.unlink(output_zip_path)
            except:
                pass
        raise Exception(f"PDF转JPG失败: {str(e)}")


def is_pdf_file(file_path):
    """
    检查文件是否为PDF格式
    
    Args:
        file_path: 文件路径
    
    Returns:
        bool: 是否为PDF文件
    """
    return os.path.isfile(file_path) and file_path.lower().endswith('.pdf')

