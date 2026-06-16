var webgalParser = (function (exports) {
  'use strict';

  var commandType;
  (function (commandType) {
      commandType[commandType["say"] = 0] = "say";
      commandType[commandType["changeBg"] = 1] = "changeBg";
      commandType[commandType["changeFigure"] = 2] = "changeFigure";
      commandType[commandType["bgm"] = 3] = "bgm";
      commandType[commandType["video"] = 4] = "video";
      commandType[commandType["pixi"] = 5] = "pixi";
      commandType[commandType["pixiInit"] = 6] = "pixiInit";
      commandType[commandType["intro"] = 7] = "intro";
      commandType[commandType["miniAvatar"] = 8] = "miniAvatar";
      commandType[commandType["changeScene"] = 9] = "changeScene";
      commandType[commandType["choose"] = 10] = "choose";
      commandType[commandType["end"] = 11] = "end";
      commandType[commandType["setComplexAnimation"] = 12] = "setComplexAnimation";
      commandType[commandType["setFilter"] = 13] = "setFilter";
      commandType[commandType["label"] = 14] = "label";
      commandType[commandType["jumpLabel"] = 15] = "jumpLabel";
      commandType[commandType["chooseLabel"] = 16] = "chooseLabel";
      commandType[commandType["setVar"] = 17] = "setVar";
      commandType[commandType["if"] = 18] = "if";
      commandType[commandType["callScene"] = 19] = "callScene";
      commandType[commandType["showVars"] = 20] = "showVars";
      commandType[commandType["unlockCg"] = 21] = "unlockCg";
      commandType[commandType["unlockBgm"] = 22] = "unlockBgm";
      commandType[commandType["filmMode"] = 23] = "filmMode";
      commandType[commandType["setTextbox"] = 24] = "setTextbox";
      commandType[commandType["setAnimation"] = 25] = "setAnimation";
      commandType[commandType["playEffect"] = 26] = "playEffect";
      commandType[commandType["setTempAnimation"] = 27] = "setTempAnimation";
      commandType[commandType["comment"] = 28] = "comment";
      commandType[commandType["setTransform"] = 29] = "setTransform";
      commandType[commandType["setTransition"] = 30] = "setTransition";
      commandType[commandType["getUserInput"] = 31] = "getUserInput";
      commandType[commandType["applyStyle"] = 32] = "applyStyle";
      commandType[commandType["wait"] = 33] = "wait";
      commandType[commandType["callSteam"] = 34] = "callSteam";
  })(commandType || (commandType = {}));

  const SCRIPT_CONFIG = [
      { scriptString: 'say', scriptType: commandType.say },
      { scriptString: 'changeBg', scriptType: commandType.changeBg },
      { scriptString: 'changeFigure', scriptType: commandType.changeFigure },
      { scriptString: 'bgm', scriptType: commandType.bgm },
      { scriptString: 'playVideo', scriptType: commandType.video },
      { scriptString: 'pixiPerform', scriptType: commandType.pixi },
      { scriptString: 'pixiInit', scriptType: commandType.pixiInit },
      { scriptString: 'intro', scriptType: commandType.intro },
      { scriptString: 'miniAvatar', scriptType: commandType.miniAvatar },
      { scriptString: 'changeScene', scriptType: commandType.changeScene },
      { scriptString: 'choose', scriptType: commandType.choose },
      { scriptString: 'end', scriptType: commandType.end },
      {
          scriptString: 'setComplexAnimation',
          scriptType: commandType.setComplexAnimation,
      },
      { scriptString: 'setFilter', scriptType: commandType.setFilter },
      { scriptString: 'label', scriptType: commandType.label },
      { scriptString: 'jumpLabel', scriptType: commandType.jumpLabel },
      { scriptString: 'chooseLabel', scriptType: commandType.chooseLabel },
      { scriptString: 'setVar', scriptType: commandType.setVar },
      { scriptString: 'if', scriptType: commandType.if },
      { scriptString: 'callScene', scriptType: commandType.callScene },
      { scriptString: 'showVars', scriptType: commandType.showVars },
      { scriptString: 'unlockCg', scriptType: commandType.unlockCg },
      { scriptString: 'unlockBgm', scriptType: commandType.unlockBgm },
      { scriptString: 'filmMode', scriptType: commandType.filmMode },
      { scriptString: 'setTextbox', scriptType: commandType.setTextbox },
      { scriptString: 'setAnimation', scriptType: commandType.setAnimation },
      { scriptString: 'playEffect', scriptType: commandType.playEffect },
      { scriptString: 'setTempAnimation', scriptType: commandType.setTempAnimation },
      // comment?
      { scriptString: 'setTransform', scriptType: commandType.setTransform },
      { scriptString: 'setTransition', scriptType: commandType.setTransition },
      { scriptString: 'getUserInput', scriptType: commandType.getUserInput },
      { scriptString: 'applyStyle', scriptType: commandType.applyStyle },
      { scriptString: 'wait', scriptType: commandType.wait },
      { scriptString: 'callSteam', scriptType: commandType.callSteam },
  ];
  const ADD_NEXT_ARG_LIST = [
      commandType.bgm,
      commandType.pixi,
      commandType.pixiInit,
      commandType.miniAvatar,
      commandType.label,
      commandType.if,
      commandType.setVar,
      commandType.unlockCg,
      commandType.unlockBgm,
      commandType.filmMode,
      commandType.playEffect,
      commandType.setTransition,
      commandType.applyStyle,
      commandType.callSteam,
  ];

  /**
   * 内置资源类型的枚举
   */
  var fileType;
  (function (fileType) {
      fileType[fileType["background"] = 0] = "background";
      fileType[fileType["bgm"] = 1] = "bgm";
      fileType[fileType["figure"] = 2] = "figure";
      fileType[fileType["scene"] = 3] = "scene";
      fileType[fileType["tex"] = 4] = "tex";
      fileType[fileType["vocal"] = 5] = "vocal";
      fileType[fileType["video"] = 6] = "video";
  })(fileType || (fileType = {}));

  /**
   * 参数解析器
   * @param argsRaw 原始参数字符串
   * @param assetSetter
   * @return {Array<arg>} 解析后的参数列表
   */
  function argsParser(argsRaw, assetSetter) {
      const returnArrayList = [];
      // 处理参数
      // 不要去空格
      let newArgsRaw = argsRaw.replace(/ /g, ' ');
      // 分割参数列表
      let rawArgsList = newArgsRaw.split(' -');
      // 去除空字符串
      rawArgsList = rawArgsList.filter((e) => {
          return e !== '';
      });
      rawArgsList.forEach((e) => {
          const equalSignIndex = e.indexOf('=');
          let argName = e.slice(0, equalSignIndex).trim();
          let argValue = e.slice(equalSignIndex + 1).trim();
          if (equalSignIndex < 0) {
              argName = e.trim();
              argValue = undefined;
          }
          // 判断是不是语音参数
          if (argName.toLowerCase().match(/.ogg|.mp3|.wav/)) {
              returnArrayList.push({
                  key: 'vocal',
                  value: assetSetter(e, fileType.vocal),
              });
          }
          else {
              // 判断是不是省略参数
              if (argValue === undefined) {
                  returnArrayList.push({
                      key: argName,
                      value: true,
                  });
              }
              else {
                  // 是字符串描述的布尔值
                  if (argValue === 'true' || argValue === 'false') {
                      returnArrayList.push({
                          key: argName,
                          value: argValue === 'true',
                      });
                  }
                  else {
                      // 是数字
                      if (!isNaN(Number(argValue))) {
                          returnArrayList.push({
                              key: argName,
                              value: Number(argValue),
                          });
                      }
                      else {
                          // 是普通参数
                          returnArrayList.push({
                              key: argName,
                              value: argValue,
                          });
                      }
                  }
              }
          }
      });
      return returnArrayList;
  }

  function configLineParser(inputLine) {
      const options = [];
      let command;
      let newSentenceRaw = inputLine.split(';')[0];
      if (newSentenceRaw === '') {
          // 注释提前返回
          return {
              command: '',
              args: [],
              options: [],
          };
      }
      // 截取命令
      const getCommandResult = /\s*:\s*/.exec(newSentenceRaw);
      // 没有command
      if (getCommandResult === null) {
          command = '';
      }
      else {
          command = newSentenceRaw.substring(0, getCommandResult.index);
          // 划分命令区域和content区域
          newSentenceRaw = newSentenceRaw.substring(getCommandResult.index + 1, newSentenceRaw.length);
      }
      // 截取 Options 区域
      const getOptionsResult = / -/.exec(newSentenceRaw);
      // 获取到参数
      if (getOptionsResult) {
          const optionsRaw = newSentenceRaw.substring(getOptionsResult.index, newSentenceRaw.length);
          newSentenceRaw = newSentenceRaw.substring(0, getOptionsResult.index);
          for (const e of argsParser(optionsRaw, (name, _) => {
              return name;
          })) {
              options.push(e);
          }
      }
      return {
          command,
          args: newSentenceRaw
              .split('|')
              .map((e) => e.trim())
              .filter((e) => e !== ''),
          options,
      };
  }
  function configParser(configText) {
      const configLines = configText.replaceAll(`\r`, '').split('\n');
      return configLines
          .map((e) => configLineParser(e))
          .filter((e) => e.command !== '');
  }

  /**
   * 处理命令
   * @param commandRaw
   * @param ADD_NEXT_ARG_LIST
   * @param SCRIPT_CONFIG_MAP
   * @return {parsedCommand} 处理后的命令
   */
  const commandParser = (commandRaw, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP) => {
      let returnCommand = {
          type: commandType.say,
          additionalArgs: [],
      };
      // 开始处理命令内容
      const type = getCommandType(commandRaw, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP);
      returnCommand.type = type;
      // 如果是对话，加上额外的参数
      if (type === commandType.say && commandRaw !== 'say') {
          returnCommand.additionalArgs.push({
              key: 'speaker',
              value: commandRaw,
          });
      }
      returnCommand = addNextArg(returnCommand, type, ADD_NEXT_ARG_LIST);
      return returnCommand;
  };
  /**
   * 根据command原始值判断是什么命令
   * @param command command原始值
   * @param ADD_NEXT_ARG_LIST
   * @param SCRIPT_CONFIG_MAP
   * @return {commandType} 得到的command类型
   */
  function getCommandType(command, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP) {
      return SCRIPT_CONFIG_MAP.get(command)?.scriptType ?? commandType.say;
  }
  function addNextArg(commandToParse, thisCommandType, ADD_NEXT_ARG_LIST) {
      if (ADD_NEXT_ARG_LIST.includes(thisCommandType)) {
          commandToParse.additionalArgs.push({
              key: 'next',
              value: true,
          });
      }
      return commandToParse;
  }

  /**
   * 解析语句内容的函数，主要作用是把文件名改为绝对地址或相对地址（根据使用情况而定）
   * @param contentRaw 原始语句内容
   * @param type 语句类型
   * @param assetSetter
   * @return {string} 解析后的语句内容
   */
  const contentParser = (contentRaw, type, assetSetter) => {
      if (contentRaw === 'none' || contentRaw === '') {
          return '';
      }
      switch (type) {
          case commandType.playEffect:
              return assetSetter(contentRaw, fileType.vocal);
          case commandType.changeBg:
              return assetSetter(contentRaw, fileType.background);
          case commandType.changeFigure:
              return assetSetter(contentRaw, fileType.figure);
          case commandType.bgm:
              return assetSetter(contentRaw, fileType.bgm);
          case commandType.callScene:
              return assetSetter(contentRaw, fileType.scene);
          case commandType.changeScene:
              return assetSetter(contentRaw, fileType.scene);
          case commandType.miniAvatar:
              return assetSetter(contentRaw, fileType.figure);
          case commandType.video:
              return assetSetter(contentRaw, fileType.video);
          case commandType.choose:
              return getChooseContent(contentRaw, assetSetter);
          case commandType.unlockBgm:
              return assetSetter(contentRaw, fileType.bgm);
          case commandType.unlockCg:
              return assetSetter(contentRaw, fileType.background);
          default:
              return contentRaw;
      }
  };
  function getChooseContent(contentRaw, assetSetter) {
      const chooseList = contentRaw.split(/(?<!\\)\|/);
      const chooseKeyList = [];
      const chooseValueList = [];
      for (const e of chooseList) {
          chooseKeyList.push(e.split(/(?<!\\):/)[0] ?? '');
          chooseValueList.push(e.split(/(?<!\\):/)[1] ?? '');
      }
      const parsedChooseList = chooseValueList.map((e) => {
          if (e.match(/\./)) {
              return assetSetter(e, fileType.scene);
          }
          else {
              return e;
          }
      });
      let ret = '';
      for (let i = 0; i < chooseKeyList.length; i++) {
          if (i !== 0) {
              ret = ret + '|';
          }
          ret = ret + `${chooseKeyList[i]}:${parsedChooseList[i]}`;
      }
      return ret;
  }

  /**
   * 根据语句类型、语句内容、参数列表，扫描该语句可能携带的资源
   * @param command 语句类型
   * @param content 语句内容
   * @param args 参数列表
   * @return {Array<IAsset>} 语句携带的参数列表
   */
  const assetsScanner = (command, content, args) => {
      const returnAssetsList = [];
      if (command === commandType.say) {
          args.forEach((e) => {
              if (e.key === 'vocal') {
                  returnAssetsList.push({
                      name: e.value,
                      url: e.value,
                      lineNumber: 0,
                      type: fileType.vocal,
                  });
              }
          });
      }
      if (content === 'none' || content === '') {
          return returnAssetsList;
      }
      // 处理语句携带的资源
      if (command === commandType.changeBg) {
          returnAssetsList.push({
              name: content,
              url: content,
              lineNumber: 0,
              type: fileType.background,
          });
      }
      if (command === commandType.changeFigure) {
          returnAssetsList.push({
              name: content,
              url: content,
              lineNumber: 0,
              type: fileType.figure,
          });
      }
      if (command === commandType.miniAvatar) {
          returnAssetsList.push({
              name: content,
              url: content,
              lineNumber: 0,
              type: fileType.figure,
          });
      }
      if (command === commandType.video) {
          returnAssetsList.push({
              name: content,
              url: content,
              lineNumber: 0,
              type: fileType.video,
          });
      }
      if (command === commandType.bgm) {
          returnAssetsList.push({
              name: content,
              url: content,
              lineNumber: 0,
              type: fileType.bgm,
          });
      }
      return returnAssetsList;
  };

  /**
   * 扫描子场景
   * @param content 语句内容
   * @return {Array<string>} 子场景列表
   */
  const subSceneScanner = (command, content) => {
      const subSceneList = [];
      if (command === commandType.changeScene ||
          command === commandType.callScene) {
          subSceneList.push(content);
      }
      if (command === commandType.choose) {
          const chooseList = content.split('|');
          const chooseValue = chooseList.map((e) => e.split(':')[1] ?? '');
          chooseValue.forEach((e) => {
              if (e.match(/\./)) {
                  subSceneList.push(e);
              }
          });
      }
      return subSceneList;
  };

  /**
   * 语句解析器
   * @param sentenceRaw 原始语句
   * @param assetSetter
   * @param ADD_NEXT_ARG_LIST
   * @param SCRIPT_CONFIG_MAP
   */
  const scriptParser = (sentenceRaw, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP) => {
      let command; // 默认为对话
      let content; // 语句内容
      let subScene; // 语句携带的子场景（可能没有）
      const args = []; // 语句参数列表
      let sentenceAssets; // 语句携带的资源列表
      let parsedCommand; // 解析后的命令
      let commandRaw;
      // 正式开始解析
      // 去分号
      const commentSplit = sentenceRaw.split(/(?<!\\);/);
      let newSentenceRaw = commentSplit[0];
      newSentenceRaw = newSentenceRaw.replaceAll('\\;', ';');
      const sentenceComment = commentSplit[1] ?? '';
      if (newSentenceRaw.trim() === '') {
          // 注释提前返回
          return {
              command: commandType.comment,
              commandRaw: 'comment',
              content: sentenceComment.trim(),
              args: [{ key: 'next', value: true }],
              sentenceAssets: [],
              subScene: [],
              inlineComment: '', // 行内注释
          };
      }
      // 截取命令
      const getCommandResult = /:/.exec(newSentenceRaw);
      /**
       * 拆分命令和语句，同时处理连续对话。
       */
      // 没有command，说明这是一条连续对话或单条语句
      if (getCommandResult === null) {
          commandRaw = newSentenceRaw;
          parsedCommand = commandParser(commandRaw, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP);
          command = parsedCommand.type;
          for (const e of parsedCommand.additionalArgs) {
              // 由于是连续对话，所以我们去除 speaker 参数。
              if (command === commandType.say && e.key === 'speaker') {
                  continue;
              }
              args.push(e);
          }
      }
      else {
          commandRaw = newSentenceRaw.substring(0, getCommandResult.index);
          // 划分命令区域和content区域
          newSentenceRaw = newSentenceRaw.substring(getCommandResult.index + 1, newSentenceRaw.length);
          parsedCommand = commandParser(commandRaw, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP);
          command = parsedCommand.type;
          for (const e of parsedCommand.additionalArgs) {
              args.push(e);
          }
      }
      // 截取参数区域
      const getArgsResult = / -/.exec(newSentenceRaw);
      // 获取到参数
      if (getArgsResult) {
          const argsRaw = newSentenceRaw.substring(getArgsResult.index, sentenceRaw.length);
          newSentenceRaw = newSentenceRaw.substring(0, getArgsResult.index);
          for (const e of argsParser(argsRaw, assetSetter)) {
              args.push(e);
          }
      }
      content = contentParser(newSentenceRaw.trim(), command, assetSetter); // 将语句内容里的文件名转为相对或绝对路径
      sentenceAssets = assetsScanner(command, content, args); // 扫描语句携带资源
      subScene = subSceneScanner(command, content); // 扫描语句携带子场景
      return {
          command: command,
          commandRaw: commandRaw.trim(),
          content: content,
          args: args,
          sentenceAssets: sentenceAssets,
          subScene: subScene,
          inlineComment: sentenceComment.trim(), // 行内注释
      };
  };

  var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

  /** Detect free variable `global` from Node.js. */

  var freeGlobal$1 = typeof commonjsGlobal == 'object' && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;

  var _freeGlobal = freeGlobal$1;

  var freeGlobal = _freeGlobal;

  /** Detect free variable `self`. */
  var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

  /** Used as a reference to the global object. */
  var root$4 = freeGlobal || freeSelf || Function('return this')();

  var _root = root$4;

  var root$3 = _root;

  /** Built-in value references. */
  var Symbol$2 = root$3.Symbol;

  var _Symbol = Symbol$2;

  var Symbol$1 = _Symbol;

  /** Used for built-in method references. */
  var objectProto$4 = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty$3 = objectProto$4.hasOwnProperty;

  /**
   * Used to resolve the
   * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
   * of values.
   */
  var nativeObjectToString$1 = objectProto$4.toString;

  /** Built-in value references. */
  var symToStringTag$1 = Symbol$1 ? Symbol$1.toStringTag : undefined;

  /**
   * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
   *
   * @private
   * @param {*} value The value to query.
   * @returns {string} Returns the raw `toStringTag`.
   */
  function getRawTag$1(value) {
    var isOwn = hasOwnProperty$3.call(value, symToStringTag$1),
        tag = value[symToStringTag$1];

    try {
      value[symToStringTag$1] = undefined;
      var unmasked = true;
    } catch (e) {}

    var result = nativeObjectToString$1.call(value);
    if (unmasked) {
      if (isOwn) {
        value[symToStringTag$1] = tag;
      } else {
        delete value[symToStringTag$1];
      }
    }
    return result;
  }

  var _getRawTag = getRawTag$1;

  /** Used for built-in method references. */

  var objectProto$3 = Object.prototype;

  /**
   * Used to resolve the
   * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
   * of values.
   */
  var nativeObjectToString = objectProto$3.toString;

  /**
   * Converts `value` to a string using `Object.prototype.toString`.
   *
   * @private
   * @param {*} value The value to convert.
   * @returns {string} Returns the converted string.
   */
  function objectToString$1(value) {
    return nativeObjectToString.call(value);
  }

  var _objectToString = objectToString$1;

  var Symbol = _Symbol,
      getRawTag = _getRawTag,
      objectToString = _objectToString;

  /** `Object#toString` result references. */
  var nullTag = '[object Null]',
      undefinedTag = '[object Undefined]';

  /** Built-in value references. */
  var symToStringTag = Symbol ? Symbol.toStringTag : undefined;

  /**
   * The base implementation of `getTag` without fallbacks for buggy environments.
   *
   * @private
   * @param {*} value The value to query.
   * @returns {string} Returns the `toStringTag`.
   */
  function baseGetTag$1(value) {
    if (value == null) {
      return value === undefined ? undefinedTag : nullTag;
    }
    return (symToStringTag && symToStringTag in Object(value))
      ? getRawTag(value)
      : objectToString(value);
  }

  var _baseGetTag = baseGetTag$1;

  /**
   * Checks if `value` is the
   * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
   * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an object, else `false`.
   * @example
   *
   * _.isObject({});
   * // => true
   *
   * _.isObject([1, 2, 3]);
   * // => true
   *
   * _.isObject(_.noop);
   * // => true
   *
   * _.isObject(null);
   * // => false
   */

  function isObject$2(value) {
    var type = typeof value;
    return value != null && (type == 'object' || type == 'function');
  }

  var isObject_1 = isObject$2;

  var baseGetTag = _baseGetTag,
      isObject$1 = isObject_1;

  /** `Object#toString` result references. */
  var asyncTag = '[object AsyncFunction]',
      funcTag = '[object Function]',
      genTag = '[object GeneratorFunction]',
      proxyTag = '[object Proxy]';

  /**
   * Checks if `value` is classified as a `Function` object.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a function, else `false`.
   * @example
   *
   * _.isFunction(_);
   * // => true
   *
   * _.isFunction(/abc/);
   * // => false
   */
  function isFunction$1(value) {
    if (!isObject$1(value)) {
      return false;
    }
    // The use of `Object#toString` avoids issues with the `typeof` operator
    // in Safari 9 which returns 'object' for typed arrays and other constructors.
    var tag = baseGetTag(value);
    return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
  }

  var isFunction_1 = isFunction$1;

  var root$2 = _root;

  /** Used to detect overreaching core-js shims. */
  var coreJsData$1 = root$2['__core-js_shared__'];

  var _coreJsData = coreJsData$1;

  var coreJsData = _coreJsData;

  /** Used to detect methods masquerading as native. */
  var maskSrcKey = (function() {
    var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
    return uid ? ('Symbol(src)_1.' + uid) : '';
  }());

  /**
   * Checks if `func` has its source masked.
   *
   * @private
   * @param {Function} func The function to check.
   * @returns {boolean} Returns `true` if `func` is masked, else `false`.
   */
  function isMasked$1(func) {
    return !!maskSrcKey && (maskSrcKey in func);
  }

  var _isMasked = isMasked$1;

  /** Used for built-in method references. */

  var funcProto$1 = Function.prototype;

  /** Used to resolve the decompiled source of functions. */
  var funcToString$1 = funcProto$1.toString;

  /**
   * Converts `func` to its source code.
   *
   * @private
   * @param {Function} func The function to convert.
   * @returns {string} Returns the source code.
   */
  function toSource$1(func) {
    if (func != null) {
      try {
        return funcToString$1.call(func);
      } catch (e) {}
      try {
        return (func + '');
      } catch (e) {}
    }
    return '';
  }

  var _toSource = toSource$1;

  var isFunction = isFunction_1,
      isMasked = _isMasked,
      isObject = isObject_1,
      toSource = _toSource;

  /**
   * Used to match `RegExp`
   * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
   */
  var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

  /** Used to detect host constructors (Safari). */
  var reIsHostCtor = /^\[object .+?Constructor\]$/;

  /** Used for built-in method references. */
  var funcProto = Function.prototype,
      objectProto$2 = Object.prototype;

  /** Used to resolve the decompiled source of functions. */
  var funcToString = funcProto.toString;

  /** Used to check objects for own properties. */
  var hasOwnProperty$2 = objectProto$2.hasOwnProperty;

  /** Used to detect if a method is native. */
  var reIsNative = RegExp('^' +
    funcToString.call(hasOwnProperty$2).replace(reRegExpChar, '\\$&')
    .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
  );

  /**
   * The base implementation of `_.isNative` without bad shim checks.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a native function,
   *  else `false`.
   */
  function baseIsNative$1(value) {
    if (!isObject(value) || isMasked(value)) {
      return false;
    }
    var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
    return pattern.test(toSource(value));
  }

  var _baseIsNative = baseIsNative$1;

  /**
   * Gets the value at `key` of `object`.
   *
   * @private
   * @param {Object} [object] The object to query.
   * @param {string} key The key of the property to get.
   * @returns {*} Returns the property value.
   */

  function getValue$1(object, key) {
    return object == null ? undefined : object[key];
  }

  var _getValue = getValue$1;

  var baseIsNative = _baseIsNative,
      getValue = _getValue;

  /**
   * Gets the native function at `key` of `object`.
   *
   * @private
   * @param {Object} object The object to query.
   * @param {string} key The key of the method to get.
   * @returns {*} Returns the function if it's native, else `undefined`.
   */
  function getNative$3(object, key) {
    var value = getValue(object, key);
    return baseIsNative(value) ? value : undefined;
  }

  var _getNative = getNative$3;

  var getNative$2 = _getNative;

  /* Built-in method references that are verified to be native. */
  var nativeCreate$4 = getNative$2(Object, 'create');

  var _nativeCreate = nativeCreate$4;

  var nativeCreate$3 = _nativeCreate;

  /**
   * Removes all key-value entries from the hash.
   *
   * @private
   * @name clear
   * @memberOf Hash
   */
  function hashClear$1() {
    this.__data__ = nativeCreate$3 ? nativeCreate$3(null) : {};
    this.size = 0;
  }

  var _hashClear = hashClear$1;

  /**
   * Removes `key` and its value from the hash.
   *
   * @private
   * @name delete
   * @memberOf Hash
   * @param {Object} hash The hash to modify.
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */

  function hashDelete$1(key) {
    var result = this.has(key) && delete this.__data__[key];
    this.size -= result ? 1 : 0;
    return result;
  }

  var _hashDelete = hashDelete$1;

  var nativeCreate$2 = _nativeCreate;

  /** Used to stand-in for `undefined` hash values. */
  var HASH_UNDEFINED$2 = '__lodash_hash_undefined__';

  /** Used for built-in method references. */
  var objectProto$1 = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty$1 = objectProto$1.hasOwnProperty;

  /**
   * Gets the hash value for `key`.
   *
   * @private
   * @name get
   * @memberOf Hash
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function hashGet$1(key) {
    var data = this.__data__;
    if (nativeCreate$2) {
      var result = data[key];
      return result === HASH_UNDEFINED$2 ? undefined : result;
    }
    return hasOwnProperty$1.call(data, key) ? data[key] : undefined;
  }

  var _hashGet = hashGet$1;

  var nativeCreate$1 = _nativeCreate;

  /** Used for built-in method references. */
  var objectProto = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty = objectProto.hasOwnProperty;

  /**
   * Checks if a hash value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf Hash
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function hashHas$1(key) {
    var data = this.__data__;
    return nativeCreate$1 ? (data[key] !== undefined) : hasOwnProperty.call(data, key);
  }

  var _hashHas = hashHas$1;

  var nativeCreate = _nativeCreate;

  /** Used to stand-in for `undefined` hash values. */
  var HASH_UNDEFINED$1 = '__lodash_hash_undefined__';

  /**
   * Sets the hash `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf Hash
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the hash instance.
   */
  function hashSet$1(key, value) {
    var data = this.__data__;
    this.size += this.has(key) ? 0 : 1;
    data[key] = (nativeCreate && value === undefined) ? HASH_UNDEFINED$1 : value;
    return this;
  }

  var _hashSet = hashSet$1;

  var hashClear = _hashClear,
      hashDelete = _hashDelete,
      hashGet = _hashGet,
      hashHas = _hashHas,
      hashSet = _hashSet;

  /**
   * Creates a hash object.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function Hash$1(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  // Add methods to `Hash`.
  Hash$1.prototype.clear = hashClear;
  Hash$1.prototype['delete'] = hashDelete;
  Hash$1.prototype.get = hashGet;
  Hash$1.prototype.has = hashHas;
  Hash$1.prototype.set = hashSet;

  var _Hash = Hash$1;

  /**
   * Removes all key-value entries from the list cache.
   *
   * @private
   * @name clear
   * @memberOf ListCache
   */

  function listCacheClear$1() {
    this.__data__ = [];
    this.size = 0;
  }

  var _listCacheClear = listCacheClear$1;

  /**
   * Performs a
   * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
   * comparison between two values to determine if they are equivalent.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to compare.
   * @param {*} other The other value to compare.
   * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
   * @example
   *
   * var object = { 'a': 1 };
   * var other = { 'a': 1 };
   *
   * _.eq(object, object);
   * // => true
   *
   * _.eq(object, other);
   * // => false
   *
   * _.eq('a', 'a');
   * // => true
   *
   * _.eq('a', Object('a'));
   * // => false
   *
   * _.eq(NaN, NaN);
   * // => true
   */

  function eq$1(value, other) {
    return value === other || (value !== value && other !== other);
  }

  var eq_1 = eq$1;

  var eq = eq_1;

  /**
   * Gets the index at which the `key` is found in `array` of key-value pairs.
   *
   * @private
   * @param {Array} array The array to inspect.
   * @param {*} key The key to search for.
   * @returns {number} Returns the index of the matched value, else `-1`.
   */
  function assocIndexOf$4(array, key) {
    var length = array.length;
    while (length--) {
      if (eq(array[length][0], key)) {
        return length;
      }
    }
    return -1;
  }

  var _assocIndexOf = assocIndexOf$4;

  var assocIndexOf$3 = _assocIndexOf;

  /** Used for built-in method references. */
  var arrayProto = Array.prototype;

  /** Built-in value references. */
  var splice = arrayProto.splice;

  /**
   * Removes `key` and its value from the list cache.
   *
   * @private
   * @name delete
   * @memberOf ListCache
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function listCacheDelete$1(key) {
    var data = this.__data__,
        index = assocIndexOf$3(data, key);

    if (index < 0) {
      return false;
    }
    var lastIndex = data.length - 1;
    if (index == lastIndex) {
      data.pop();
    } else {
      splice.call(data, index, 1);
    }
    --this.size;
    return true;
  }

  var _listCacheDelete = listCacheDelete$1;

  var assocIndexOf$2 = _assocIndexOf;

  /**
   * Gets the list cache value for `key`.
   *
   * @private
   * @name get
   * @memberOf ListCache
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function listCacheGet$1(key) {
    var data = this.__data__,
        index = assocIndexOf$2(data, key);

    return index < 0 ? undefined : data[index][1];
  }

  var _listCacheGet = listCacheGet$1;

  var assocIndexOf$1 = _assocIndexOf;

  /**
   * Checks if a list cache value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf ListCache
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function listCacheHas$1(key) {
    return assocIndexOf$1(this.__data__, key) > -1;
  }

  var _listCacheHas = listCacheHas$1;

  var assocIndexOf = _assocIndexOf;

  /**
   * Sets the list cache `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf ListCache
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the list cache instance.
   */
  function listCacheSet$1(key, value) {
    var data = this.__data__,
        index = assocIndexOf(data, key);

    if (index < 0) {
      ++this.size;
      data.push([key, value]);
    } else {
      data[index][1] = value;
    }
    return this;
  }

  var _listCacheSet = listCacheSet$1;

  var listCacheClear = _listCacheClear,
      listCacheDelete = _listCacheDelete,
      listCacheGet = _listCacheGet,
      listCacheHas = _listCacheHas,
      listCacheSet = _listCacheSet;

  /**
   * Creates an list cache object.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function ListCache$1(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  // Add methods to `ListCache`.
  ListCache$1.prototype.clear = listCacheClear;
  ListCache$1.prototype['delete'] = listCacheDelete;
  ListCache$1.prototype.get = listCacheGet;
  ListCache$1.prototype.has = listCacheHas;
  ListCache$1.prototype.set = listCacheSet;

  var _ListCache = ListCache$1;

  var getNative$1 = _getNative,
      root$1 = _root;

  /* Built-in method references that are verified to be native. */
  var Map$2 = getNative$1(root$1, 'Map');

  var _Map = Map$2;

  var Hash = _Hash,
      ListCache = _ListCache,
      Map$1 = _Map;

  /**
   * Removes all key-value entries from the map.
   *
   * @private
   * @name clear
   * @memberOf MapCache
   */
  function mapCacheClear$1() {
    this.size = 0;
    this.__data__ = {
      'hash': new Hash,
      'map': new (Map$1 || ListCache),
      'string': new Hash
    };
  }

  var _mapCacheClear = mapCacheClear$1;

  /**
   * Checks if `value` is suitable for use as unique object key.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
   */

  function isKeyable$1(value) {
    var type = typeof value;
    return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
      ? (value !== '__proto__')
      : (value === null);
  }

  var _isKeyable = isKeyable$1;

  var isKeyable = _isKeyable;

  /**
   * Gets the data for `map`.
   *
   * @private
   * @param {Object} map The map to query.
   * @param {string} key The reference key.
   * @returns {*} Returns the map data.
   */
  function getMapData$4(map, key) {
    var data = map.__data__;
    return isKeyable(key)
      ? data[typeof key == 'string' ? 'string' : 'hash']
      : data.map;
  }

  var _getMapData = getMapData$4;

  var getMapData$3 = _getMapData;

  /**
   * Removes `key` and its value from the map.
   *
   * @private
   * @name delete
   * @memberOf MapCache
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function mapCacheDelete$1(key) {
    var result = getMapData$3(this, key)['delete'](key);
    this.size -= result ? 1 : 0;
    return result;
  }

  var _mapCacheDelete = mapCacheDelete$1;

  var getMapData$2 = _getMapData;

  /**
   * Gets the map value for `key`.
   *
   * @private
   * @name get
   * @memberOf MapCache
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function mapCacheGet$1(key) {
    return getMapData$2(this, key).get(key);
  }

  var _mapCacheGet = mapCacheGet$1;

  var getMapData$1 = _getMapData;

  /**
   * Checks if a map value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf MapCache
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function mapCacheHas$1(key) {
    return getMapData$1(this, key).has(key);
  }

  var _mapCacheHas = mapCacheHas$1;

  var getMapData = _getMapData;

  /**
   * Sets the map `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf MapCache
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the map cache instance.
   */
  function mapCacheSet$1(key, value) {
    var data = getMapData(this, key),
        size = data.size;

    data.set(key, value);
    this.size += data.size == size ? 0 : 1;
    return this;
  }

  var _mapCacheSet = mapCacheSet$1;

  var mapCacheClear = _mapCacheClear,
      mapCacheDelete = _mapCacheDelete,
      mapCacheGet = _mapCacheGet,
      mapCacheHas = _mapCacheHas,
      mapCacheSet = _mapCacheSet;

  /**
   * Creates a map cache object to store key-value pairs.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function MapCache$1(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  // Add methods to `MapCache`.
  MapCache$1.prototype.clear = mapCacheClear;
  MapCache$1.prototype['delete'] = mapCacheDelete;
  MapCache$1.prototype.get = mapCacheGet;
  MapCache$1.prototype.has = mapCacheHas;
  MapCache$1.prototype.set = mapCacheSet;

  var _MapCache = MapCache$1;

  /** Used to stand-in for `undefined` hash values. */

  var HASH_UNDEFINED = '__lodash_hash_undefined__';

  /**
   * Adds `value` to the array cache.
   *
   * @private
   * @name add
   * @memberOf SetCache
   * @alias push
   * @param {*} value The value to cache.
   * @returns {Object} Returns the cache instance.
   */
  function setCacheAdd$1(value) {
    this.__data__.set(value, HASH_UNDEFINED);
    return this;
  }

  var _setCacheAdd = setCacheAdd$1;

  /**
   * Checks if `value` is in the array cache.
   *
   * @private
   * @name has
   * @memberOf SetCache
   * @param {*} value The value to search for.
   * @returns {number} Returns `true` if `value` is found, else `false`.
   */

  function setCacheHas$1(value) {
    return this.__data__.has(value);
  }

  var _setCacheHas = setCacheHas$1;

  var MapCache = _MapCache,
      setCacheAdd = _setCacheAdd,
      setCacheHas = _setCacheHas;

  /**
   *
   * Creates an array cache object to store unique values.
   *
   * @private
   * @constructor
   * @param {Array} [values] The values to cache.
   */
  function SetCache$1(values) {
    var index = -1,
        length = values == null ? 0 : values.length;

    this.__data__ = new MapCache;
    while (++index < length) {
      this.add(values[index]);
    }
  }

  // Add methods to `SetCache`.
  SetCache$1.prototype.add = SetCache$1.prototype.push = setCacheAdd;
  SetCache$1.prototype.has = setCacheHas;

  var _SetCache = SetCache$1;

  /**
   * The base implementation of `_.findIndex` and `_.findLastIndex` without
   * support for iteratee shorthands.
   *
   * @private
   * @param {Array} array The array to inspect.
   * @param {Function} predicate The function invoked per iteration.
   * @param {number} fromIndex The index to search from.
   * @param {boolean} [fromRight] Specify iterating from right to left.
   * @returns {number} Returns the index of the matched value, else `-1`.
   */

  function baseFindIndex$1(array, predicate, fromIndex, fromRight) {
    var length = array.length,
        index = fromIndex + (fromRight ? 1 : -1);

    while ((fromRight ? index-- : ++index < length)) {
      if (predicate(array[index], index, array)) {
        return index;
      }
    }
    return -1;
  }

  var _baseFindIndex = baseFindIndex$1;

  /**
   * The base implementation of `_.isNaN` without support for number objects.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is `NaN`, else `false`.
   */

  function baseIsNaN$1(value) {
    return value !== value;
  }

  var _baseIsNaN = baseIsNaN$1;

  /**
   * A specialized version of `_.indexOf` which performs strict equality
   * comparisons of values, i.e. `===`.
   *
   * @private
   * @param {Array} array The array to inspect.
   * @param {*} value The value to search for.
   * @param {number} fromIndex The index to search from.
   * @returns {number} Returns the index of the matched value, else `-1`.
   */

  function strictIndexOf$1(array, value, fromIndex) {
    var index = fromIndex - 1,
        length = array.length;

    while (++index < length) {
      if (array[index] === value) {
        return index;
      }
    }
    return -1;
  }

  var _strictIndexOf = strictIndexOf$1;

  var baseFindIndex = _baseFindIndex,
      baseIsNaN = _baseIsNaN,
      strictIndexOf = _strictIndexOf;

  /**
   * The base implementation of `_.indexOf` without `fromIndex` bounds checks.
   *
   * @private
   * @param {Array} array The array to inspect.
   * @param {*} value The value to search for.
   * @param {number} fromIndex The index to search from.
   * @returns {number} Returns the index of the matched value, else `-1`.
   */
  function baseIndexOf$1(array, value, fromIndex) {
    return value === value
      ? strictIndexOf(array, value, fromIndex)
      : baseFindIndex(array, baseIsNaN, fromIndex);
  }

  var _baseIndexOf = baseIndexOf$1;

  var baseIndexOf = _baseIndexOf;

  /**
   * A specialized version of `_.includes` for arrays without support for
   * specifying an index to search from.
   *
   * @private
   * @param {Array} [array] The array to inspect.
   * @param {*} target The value to search for.
   * @returns {boolean} Returns `true` if `target` is found, else `false`.
   */
  function arrayIncludes$1(array, value) {
    var length = array == null ? 0 : array.length;
    return !!length && baseIndexOf(array, value, 0) > -1;
  }

  var _arrayIncludes = arrayIncludes$1;

  /**
   * This function is like `arrayIncludes` except that it accepts a comparator.
   *
   * @private
   * @param {Array} [array] The array to inspect.
   * @param {*} target The value to search for.
   * @param {Function} comparator The comparator invoked per element.
   * @returns {boolean} Returns `true` if `target` is found, else `false`.
   */

  function arrayIncludesWith$1(array, value, comparator) {
    var index = -1,
        length = array == null ? 0 : array.length;

    while (++index < length) {
      if (comparator(value, array[index])) {
        return true;
      }
    }
    return false;
  }

  var _arrayIncludesWith = arrayIncludesWith$1;

  /**
   * Checks if a `cache` value for `key` exists.
   *
   * @private
   * @param {Object} cache The cache to query.
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */

  function cacheHas$1(cache, key) {
    return cache.has(key);
  }

  var _cacheHas = cacheHas$1;

  var getNative = _getNative,
      root = _root;

  /* Built-in method references that are verified to be native. */
  var Set$1 = getNative(root, 'Set');

  var _Set = Set$1;

  /**
   * This method returns `undefined`.
   *
   * @static
   * @memberOf _
   * @since 2.3.0
   * @category Util
   * @example
   *
   * _.times(2, _.noop);
   * // => [undefined, undefined]
   */

  function noop$1() {
    // No operation performed.
  }

  var noop_1 = noop$1;

  /**
   * Converts `set` to an array of its values.
   *
   * @private
   * @param {Object} set The set to convert.
   * @returns {Array} Returns the values.
   */

  function setToArray$2(set) {
    var index = -1,
        result = Array(set.size);

    set.forEach(function(value) {
      result[++index] = value;
    });
    return result;
  }

  var _setToArray = setToArray$2;

  var Set = _Set,
      noop = noop_1,
      setToArray$1 = _setToArray;

  /** Used as references for various `Number` constants. */
  var INFINITY = 1 / 0;

  /**
   * Creates a set object of `values`.
   *
   * @private
   * @param {Array} values The values to add to the set.
   * @returns {Object} Returns the new set.
   */
  var createSet$1 = !(Set && (1 / setToArray$1(new Set([,-0]))[1]) == INFINITY) ? noop : function(values) {
    return new Set(values);
  };

  var _createSet = createSet$1;

  var SetCache = _SetCache,
      arrayIncludes = _arrayIncludes,
      arrayIncludesWith = _arrayIncludesWith,
      cacheHas = _cacheHas,
      createSet = _createSet,
      setToArray = _setToArray;

  /** Used as the size to enable large array optimizations. */
  var LARGE_ARRAY_SIZE = 200;

  /**
   * The base implementation of `_.uniqBy` without support for iteratee shorthands.
   *
   * @private
   * @param {Array} array The array to inspect.
   * @param {Function} [iteratee] The iteratee invoked per element.
   * @param {Function} [comparator] The comparator invoked per element.
   * @returns {Array} Returns the new duplicate free array.
   */
  function baseUniq$1(array, iteratee, comparator) {
    var index = -1,
        includes = arrayIncludes,
        length = array.length,
        isCommon = true,
        result = [],
        seen = result;

    if (comparator) {
      isCommon = false;
      includes = arrayIncludesWith;
    }
    else if (length >= LARGE_ARRAY_SIZE) {
      var set = iteratee ? null : createSet(array);
      if (set) {
        return setToArray(set);
      }
      isCommon = false;
      includes = cacheHas;
      seen = new SetCache;
    }
    else {
      seen = iteratee ? [] : result;
    }
    outer:
    while (++index < length) {
      var value = array[index],
          computed = iteratee ? iteratee(value) : value;

      value = (comparator || value !== 0) ? value : 0;
      if (isCommon && computed === computed) {
        var seenIndex = seen.length;
        while (seenIndex--) {
          if (seen[seenIndex] === computed) {
            continue outer;
          }
        }
        if (iteratee) {
          seen.push(computed);
        }
        result.push(value);
      }
      else if (!includes(seen, computed, comparator)) {
        if (seen !== result) {
          seen.push(computed);
        }
        result.push(value);
      }
    }
    return result;
  }

  var _baseUniq = baseUniq$1;

  var baseUniq = _baseUniq;

  /**
   * This method is like `_.uniq` except that it accepts `comparator` which
   * is invoked to compare elements of `array`. The order of result values is
   * determined by the order they occur in the array.The comparator is invoked
   * with two arguments: (arrVal, othVal).
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Array
   * @param {Array} array The array to inspect.
   * @param {Function} [comparator] The comparator invoked per element.
   * @returns {Array} Returns the new duplicate free array.
   * @example
   *
   * var objects = [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }, { 'x': 1, 'y': 2 }];
   *
   * _.uniqWith(objects, _.isEqual);
   * // => [{ 'x': 1, 'y': 2 }, { 'x': 2, 'y': 1 }]
   */
  function uniqWith(array, comparator) {
    comparator = typeof comparator == 'function' ? comparator : undefined;
    return (array && array.length) ? baseUniq(array, undefined, comparator) : [];
  }

  var uniqWith_1 = uniqWith;

  /**
   * 场景解析器
   * @param rawScene 原始场景
   * @param sceneName 场景名称
   * @param sceneUrl 场景url
   * @param assetsPrefetcher
   * @param assetSetter
   * @param ADD_NEXT_ARG_LIST
   * @param SCRIPT_CONFIG_MAP
   * @return {IScene} 解析后的场景
   */
  const sceneParser = (rawScene, sceneName, sceneUrl, assetsPrefetcher, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP) => {
      const rawSentenceList = rawScene.replaceAll('\r', '').split('\n'); // 原始句子列表
      // 去分号留到后面去做了，现在注释要单独处理
      const rawSentenceListWithoutEmpty = rawSentenceList;
      // .map((sentence) => sentence.split(";")[0])
      // .filter((sentence) => sentence.trim() !== "");
      let assetsList = []; // 场景资源列表
      let subSceneList = []; // 子场景列表
      const sentenceList = rawSentenceListWithoutEmpty.map((sentence) => {
          const returnSentence = scriptParser(sentence, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP);
          // 在这里解析出语句可能携带的资源和场景，合并到 assetsList 和 subSceneList
          assetsList = [...assetsList, ...returnSentence.sentenceAssets];
          subSceneList = [...subSceneList, ...returnSentence.subScene];
          return returnSentence;
      });
      // 开始资源的预加载
      assetsList = uniqWith_1(assetsList); // 去重
      assetsPrefetcher(assetsList);
      return {
          sceneName: sceneName,
          sceneUrl: sceneUrl,
          sentenceList: sentenceList,
          assetsList: assetsList,
          subSceneList: subSceneList, // 子场景列表
      };
  };

  function scss2cssinjsParser(scssString) {
      const [classNameStyles, others] = parseCSS(scssString);
      return {
          classNameStyles,
          others,
      };
  }
  /**
   * GPT 4 写的，临时用，以后要重构！！！
   * TODO：用人类智能重构，要是用着一直没问题，也不是不可以 trust AI
   * @param css
   */
  function parseCSS(css) {
      const result = {};
      let specialRules = '';
      let matches;
      // 使用非贪婪匹配，尝试正确处理任意层次的嵌套
      const classRegex = /\.([^{\s]+)\s*{((?:[^{}]*|{[^}]*})*)}/g;
      const specialRegex = /(@[^{]+{\s*(?:[^{}]*{[^}]*}[^{}]*)+\s*})/g;
      while ((matches = classRegex.exec(css)) !== null) {
          const key = matches[1];
          const value = matches[2].trim().replace(/\s*;\s*/g, ';\n');
          result[key] = value;
      }
      while ((matches = specialRegex.exec(css)) !== null) {
          specialRules += matches[1].trim() + '\n';
      }
      return [result, specialRules.trim()];
  }

  /**
   * Preprocessor for scene text.
   *
   * Use two-pass to generate a new scene text that concats multiline sequences
   * into a single line and add placeholder lines to preserve the original number
   * of lines.
   *
   * @param sceneText The original scene text
   * @returns The processed scene text
   */
  function sceneTextPreProcess(sceneText) {
      let lines = sceneText.replaceAll('\r', '').split('\n');
      lines = sceneTextPreProcessPassOne(lines);
      lines = sceneTextPreProcessPassTwo(lines);
      return lines.join('\n');
  }
  /**
   * Pass one.
   *
   * Add escape character to all lines that should be multiline.
   *
   * @param lines The original lines
   * @returns The processed lines
   */
  function sceneTextPreProcessPassOne(lines) {
      const processedLines = [];
      let lastLineIsMultiline = false;
      let thisLineIsMultiline = false;
      for (const line of lines) {
          thisLineIsMultiline = false;
          if (canBeMultiline(line)) {
              thisLineIsMultiline = true;
          }
          if (shouldNotBeMultiline(line, lastLineIsMultiline)) {
              thisLineIsMultiline = false;
          }
          if (thisLineIsMultiline) {
              processedLines[processedLines.length - 1] += '\\';
          }
          processedLines.push(line);
          lastLineIsMultiline = thisLineIsMultiline;
      }
      return processedLines;
  }
  function canBeMultiline(line) {
      if (!line.startsWith(' ')) {
          return false;
      }
      const trimmedLine = line.trimStart();
      return trimmedLine.startsWith('|') || trimmedLine.startsWith('-');
  }
  /**
   * Logic to check if a line should not be multiline.
   *
   * @param line The line to check
   * @returns If the line should not be multiline
   */
  function shouldNotBeMultiline(line, lastLineIsMultiline) {
      if (!lastLineIsMultiline && isEmptyLine(line)) {
          return true;
      }
      // Custom logic: if the line contains -concat, it should not be multiline
      if (line.indexOf('-concat') !== -1) {
          return true;
      }
      return false;
  }
  function isEmptyLine(line) {
      return line.trim() === '';
  }
  /**
   * Pass two.
   *
   * Traverse the lines to
   * - remove escape characters
   * - add placeholder lines to preserve the original number of lines.
   *
   * @param lines The lines in pass one
   * @returns The processed lines
   */
  function sceneTextPreProcessPassTwo(lines) {
      const processedLines = [];
      let currentMultilineContent = "";
      let placeHolderLines = [];
      function concat(line) {
          let trimmed = line.trim();
          if (trimmed.startsWith('-')) {
              trimmed = " " + trimmed;
          }
          currentMultilineContent = currentMultilineContent + trimmed;
          placeHolderLines.push(placeholderLine(line));
      }
      for (const line of lines) {
          console.log(line);
          if (line.endsWith('\\')) {
              const trueLine = line.slice(0, -1);
              if (currentMultilineContent === "") {
                  // first line
                  currentMultilineContent = trueLine;
              }
              else {
                  // middle line
                  concat(trueLine);
              }
              continue;
          }
          if (currentMultilineContent !== "") {
              // end line
              concat(line);
              processedLines.push(currentMultilineContent);
              processedLines.push(...placeHolderLines);
              placeHolderLines = [];
              currentMultilineContent = "";
              continue;
          }
          processedLines.push(line);
      }
      return processedLines;
  }
  /**
   * Placeholder Line. Adding this line preserves the original number of lines
   * in the scene text, so that it can be compatible with the graphical editor.
   *
   * @param content The original content on this line
   * @returns The placeholder line
   */
  function placeholderLine(content = "") {
      return ";_WEBGAL_LINE_BREAK_" + content;
  }
  // export function sceneTextPreProcess(sceneText: string): string {
  //   const lines = sceneText.replaceAll('\r', '').split('\n');
  //   const processedLines: string[] = [];
  //   let lastNonMultilineIndex = -1;
  //   let isInMultilineSequence = false;
  //   function isMultiline(line: string): boolean {
  //     if (!line.startsWith(' ')) return false;
  //     const trimmedLine = line.trimStart();
  //     return trimmedLine.startsWith('|') || trimmedLine.startsWith('-');
  //   }
  //   for (let i = 0; i < lines.length; i++) {
  //     const line = lines[i];
  //     if (line.trim() === '') {
  //       // Empty line handling
  //       if (isInMultilineSequence) {
  //         // Check if the next line is a multiline line
  //         let isStillInMulti = false;
  //         for (let j = i + 1; j < lines.length; j++) {
  //           const lookForwardLine = lines[j] || '';
  //           // 遇到正常语句了，直接中断
  //           if (lookForwardLine.trim() !== '' && !isMultiline(lookForwardLine)) {
  //             isStillInMulti = false;
  //             break;
  //           }
  //           // 必须找到后面接的是参数，并且中间没有遇到任何正常语句才行
  //           if (lookForwardLine.trim() !== '' && isMultiline(lookForwardLine)) {
  //             isStillInMulti = true;
  //             break;
  //           }
  //         }
  //         if (isStillInMulti) {
  //           // Still within a multiline sequence
  //           processedLines.push(';_WEBGAL_LINE_BREAK_');
  //         } else {
  //           // End of multiline sequence
  //           isInMultilineSequence = false;
  //           processedLines.push(line);
  //         }
  //       } else {
  //         // Preserve empty lines outside of multiline sequences
  //         processedLines.push(line);
  //       }
  //     } else if (isMultiline(line)) {
  //       // Multiline statement handling
  //       if (lastNonMultilineIndex >= 0) {
  //         // Concatenate to the previous non-multiline statement
  //         const trimedLine = line.trimStart();
  //         const addBlank = trimedLine.startsWith('-') ? ' ' : '';
  //         processedLines[lastNonMultilineIndex] += addBlank + trimedLine;
  //       }
  //       // Add the special comment line
  //       processedLines.push(';_WEBGAL_LINE_BREAK_' + line);
  //       isInMultilineSequence = true;
  //     } else {
  //       // Non-multiline statement handling
  //       processedLines.push(line);
  //       lastNonMultilineIndex = processedLines.length - 1;
  //       isInMultilineSequence = false;
  //     }
  //   }
  //   return processedLines.join('\n');
  // }

  class SceneParser {
      assetsPrefetcher;
      assetSetter;
      ADD_NEXT_ARG_LIST;
      SCRIPT_CONFIG_MAP;
      constructor(assetsPrefetcher, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_INPUT) {
          this.assetsPrefetcher = assetsPrefetcher;
          this.assetSetter = assetSetter;
          this.ADD_NEXT_ARG_LIST = ADD_NEXT_ARG_LIST;
          if (Array.isArray(SCRIPT_CONFIG_INPUT)) {
              this.SCRIPT_CONFIG_MAP = new Map();
              SCRIPT_CONFIG_INPUT.forEach((config) => {
                  this.SCRIPT_CONFIG_MAP.set(config.scriptString, config);
              });
          }
          else {
              this.SCRIPT_CONFIG_MAP = SCRIPT_CONFIG_INPUT;
          }
      }
      /**
       * 解析场景
       * @param rawScene 原始场景
       * @param sceneName 场景名称
       * @param sceneUrl 场景url
       * @return 解析后的场景
       */
      parse(rawScene, sceneName, sceneUrl) {
          return sceneParser(rawScene, sceneName, sceneUrl, this.assetsPrefetcher, this.assetSetter, this.ADD_NEXT_ARG_LIST, this.SCRIPT_CONFIG_MAP);
      }
      parseConfig(configText) {
          return configParser(configText);
      }
      stringifyConfig(config) {
          return config.reduce((previousValue, curr) => previousValue +
              `${curr.command}:${curr.args.join('|')}${curr.options.length <= 0
                ? ''
                : curr.options.reduce((p, c) => p + ' -' + c.key + '=' + c.value, '')};\n`, '');
      }
      parseScssToWebgalStyleObj(scssString) {
          return scss2cssinjsParser(scssString);
      }
  }

  exports.ADD_NEXT_ARG_LIST = ADD_NEXT_ARG_LIST;
  exports.SCRIPT_CONFIG = SCRIPT_CONFIG;
  exports.default = SceneParser;
  exports.sceneTextPreProcess = sceneTextPreProcess;

  Object.defineProperty(exports, '__esModule', { value: true });

  return exports;

})({});
