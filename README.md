# Web网盘

一个基于Flask的Web网盘应用，支持文件上传、下载、删除功能，界面美观，支持局域网访问。

## 功能特性

- ✅ 文件上传（支持拖拽上传）
- ✅ 文件下载
- ✅ 文件删除
- ✅ 文件列表展示
- ✅ 美观的现代化UI界面
- ✅ 支持局域网访问
- ✅ 响应式设计，支持移动端

## 环境要求

- Python 3.6+
- pipenv

## 安装步骤

1. 确保已安装pipenv：
```bash
pip install pipenv
```

2. 使用指定的Python解释器安装依赖：
```bash
pipenv install --python 3.10 # 或者指定python interpreter
poinenv install --python /path/to/python
```

3. 激活虚拟环境：
```bash
pipenv shell
```

## 运行应用

1. 激活虚拟环境（如果未激活）：
```bash
pipenv shell
```

2. 启动应用：
```bash
python app.py
```

或者使用pipenv运行：
```bash
pipenv run python app.py
```

3. 访问应用：
   - 本地访问：http://127.0.0.1:8000
   - 局域网访问：http://<你的IP地址>:8000

启动后，终端会显示具体的访问地址。

## 项目结构

```
clouddisk/
├── app.py              # Flask应用主文件
├── config.py           # 配置文件（所有配置项集中管理）
├── Pipfile             # pipenv依赖配置
├── Pipfile.lock        # 依赖锁定文件（自动生成）
├── templates/          # HTML模板目录
│   └── index.html      # 主页面
├── uploads/            # 文件上传目录（自动创建）
└── README.md           # 项目说明文档
```

## 配置说明

所有配置项都在 `config.py` 文件中，可以根据需要修改：

### 服务器配置
- **HOST**：服务器监听地址，默认 `'0.0.0.0'`（支持局域网访问）
- **PORT**：服务端口，默认 `8000`
- **DEBUG**：调试模式，默认 `True`（生产环境建议设置为 `False`）

### 文件管理配置
- **UPLOAD_FOLDER**：文件上传目录，默认 `'uploads'`
- **MAX_CONTENT_LENGTH**：最大上传文件大小（字节），默认 `1GB`
  - 100MB：`100 * 1024 * 1024`
  - 500MB：`500 * 1024 * 1024`
  - 2GB：`2 * 1024 * 1024 * 1024`

### 安全配置
- **SECRET_KEY**：Flask会话密钥，生产环境请务必修改

### 文件类型限制
- **ALLOWED_EXTENSIONS**：允许的文件扩展名集合
  - 空集合 `set()` 表示允许所有文件类型
  - 限制特定类型：`{'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx'}`

修改配置后，重启应用即可生效。

## 注意事项

1. 首次运行会自动创建`uploads/`目录用于存储上传的文件
2. 如果上传的文件名已存在，会自动添加时间戳重命名
3. 支持所有文件类型上传
4. 确保防火墙允许8000端口的访问，以便局域网内其他设备访问

## 安全提示

⚠️ 这是一个简单的网盘应用，适合在受信任的局域网内使用。在生产环境使用前，请考虑添加：
- 用户认证和授权
- 文件类型限制
- 更严格的安全措施
- HTTPS支持

## 许可证

MIT License

