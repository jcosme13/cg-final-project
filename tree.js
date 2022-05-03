"use strict";

var canvas;
var gl;

var program;

const cameraTarget = [0, 6, 0];
const cameraPosition = [0, 0, -10];

var pointsArray = []
var normalsArray = []

var lightPosition = vec4(1.0, 2.0, 5.0, 1.0); // default 10 am
var lightAmbient = vec4(0.3, 0.3, 0.3, 1.0);
var lightDiffuse = vec4(1.0, 1.0, 1.0, 1.0);
var lightSpecular = vec4(1.0, 1.0, 1.0, 1.0);

// must specify reflectivity coefficients
var materialAmbient = vec4(1.0, 0.0, 1.0, 1.0);
var materialDiffuse = vec4(1.0, 0.8, 0.0, 1.0);
var materialSpecular = vec4(1.0, 0.8, 0.0, 1.0);
var materialShininess = 100.0; // must specify shininess for specular component

var ambientProduct;
var diffuseProduct;
var specularProduct;

var near = 0.1;
var far = 50;
var radius = 4.0;
var dr = 5.0 * Math.PI / 180.0;
var phi = -24 * dr;
var theta = 28 * dr;

var fovy = 60.0 * Math.PI / 180;        // Field-of-view in Y direction angle 
var aspect = 1.0;       // Viewport aspect ratio

var modelViewMatrix, projectionMatrix;
var modelView, proj;
var eye;
const at = vec3(0.0, 0.0, 0.0);
const up = vec3(0.0, 1.0, 0.0);

var response;
var data;
var text;
var bufferInfo;
var meshProgramInfo

// This is not a full .obj parser.
// see http://paulbourke.net/dataformats/obj/

function parseOBJ(text) {
  // because indices are base 1 let's just fill in the 0th data
  const objPositions = [[0, 0, 0]];
  const objTexcoords = [[0, 0]];
  const objNormals = [[0, 0, 0]];

  // same order as `f` indices
  const objVertexData = [
    objPositions,
    objTexcoords,
    objNormals,
  ];

  // same order as `f` indices
  let webglVertexData = [
    [],   // positions
    [],   // texcoords
    [],   // normals
  ];

  function newGeometry() {
    // If there is an existing geometry and it's
    // not empty then start a new one.
    if (geometry && geometry.data.position.length) {
      geometry = undefined;
    }
    setGeometry();
  }

  function addVertex(vert) {
    const ptn = vert.split('/');
    ptn.forEach((objIndexStr, i) => {
      if (!objIndexStr) {
        return;
      }
      const objIndex = parseInt(objIndexStr);
      const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
      webglVertexData[i].push(...objVertexData[i][index]);
    });
  }

  const keywords = {
    v(parts) {
      objPositions.push(parts.map(parseFloat));
    },
    vn(parts) {
      objNormals.push(parts.map(parseFloat));
    },
    vt(parts) {
      // should check for missing v and extra w?
      objTexcoords.push(parts.map(parseFloat));
    },
    f(parts) {
      const numTriangles = parts.length - 2;
      for (let tri = 0; tri < numTriangles; ++tri) {
        addVertex(parts[0]);
        addVertex(parts[tri + 1]);
        addVertex(parts[tri + 2]);
      }
    },
  };

  const keywordRE = /(\w*)(?: )*(.*)/;
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
    const line = lines[lineNo].trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const m = keywordRE.exec(line);
    if (!m) {
      continue;
    }
    const [, keyword, unparsedArgs] = m;
    const parts = line.split(/\s+/).slice(1);
    const handler = keywords[keyword];
    if (!handler) {
      console.warn('unhandled keyword:', keyword);  // eslint-disable-line no-console
      continue;
    }
    handler(parts, unparsedArgs);
  }

  return {
    position: webglVertexData[0],
    texcoord: webglVertexData[1],
    normal: webglVertexData[2],
  };
}

window.onload = async function init() {
  // Get A WebGL context
  ///** @type {HTMLCanvasElement} */
  //const canvas = document.querySelector("#canvas");
  //const gl = canvas.getContext("webgl");
  canvas = document.getElementById("gl-canvas")

  gl = WebGLUtils.setupWebGL(canvas)
  if (!gl) {
    alert("WebGL isn't available");
  }

  gl.clearColor(0.5, 1.0, 0.0, 0.0);

  webglUtils.resizeCanvasToDisplaySize(gl.canvas);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);

  program = initShaders(gl, "vertex-shader","fragment-shader");
  gl.useProgram(program)

  var cBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(normalsArray), gl.STATIC_DRAW);

  var vNormal = gl.getAttribLocation(program, "vNormal");
  gl.vertexAttribPointer(vNormal, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vNormal);

  var vBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(pointsArray), gl.STATIC_DRAW);

  var vPosition = gl.getAttribLocation(program, "vPosition");
  gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vPosition);

  response = await fetch('treeFolder/treeTest.obj');  
  text = await response.text();
  data = parseOBJ(text);

  bufferInfo = webglUtils.createBufferInfoFromArrays(gl, data);
  
  ambientProduct = mult(lightAmbient, materialAmbient);
  diffuseProduct = mult(lightDiffuse, materialDiffuse);
  specularProduct = mult(lightSpecular, materialSpecular);

  modelView = gl.getUniformLocation(program, "modelViewMatrix");
  proj = gl.getUniformLocation(program, "projectionMatrix");

  const vs = `
  attribute vec4 a_position;
  attribute vec3 a_normal;

  uniform mat4 u_projection;
  uniform mat4 u_view;
  uniform mat4 u_world;

  varying vec3 v_normal;

  void main() {
    gl_Position = u_projection * u_view * u_world * a_position;
    v_normal = mat3(u_world) * a_normal;
  }
  `;

  const fs = `
  precision mediump float;

  varying vec3 v_normal;

  uniform vec4 u_diffuse;
  uniform vec3 u_lightDirection;

  void main () {
    vec3 normal = normalize(v_normal);
    float fakeLight = dot(u_lightDirection, normal) * .5 + .5;
    gl_FragColor = vec4(u_diffuse.rgb * fakeLight, u_diffuse.a);
  }
  `;


  // compiles and links the shaders, looks up attribute and uniform locations
  meshProgramInfo = webglUtils.createProgramInfo(gl, [vs, fs]);

  requestAnimationFrame(render);
}

  // render function
  function render(time) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    time *= 0.001;  // convert to seconds

    const projection = m4.perspective(fovy, aspect, near, far);

    const up = [0, 1, 0];
    // Compute the camera's matrix using look at.
    const camera = m4.lookAt(cameraPosition, cameraTarget, up);

    // Make a view matrix from the camera matrix.
    const view = m4.inverse(camera);


    const sharedUniforms = {
      u_lightDirection: m4.normalize([-1, 3, 5]),
      u_view: view,
      u_projection: projection,
    };
   

    eye = vec3(radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.sin(theta) * Math.sin(phi), radius * Math.cos(theta));

    modelViewMatrix = lookAt(eye, at, up);
    projectionMatrix = perspective(fovy, aspect, near, far);

    gl.uniformMatrix4fv(modelView, false, flatten(modelViewMatrix));
    gl.uniformMatrix4fv(proj, false, flatten(projectionMatrix));

    gl.uniform4fv(gl.getUniformLocation(program, "ambientProduct"),
        flatten(ambientProduct));
    gl.uniform4fv(gl.getUniformLocation(program, "diffuseProduct"),
        flatten(diffuseProduct));
    gl.uniform4fv(gl.getUniformLocation(program, "specularProduct"),
        flatten(specularProduct));
    gl.uniform4fv(gl.getUniformLocation(program, "lightPosition"),
        flatten(lightPosition));
    gl.uniform1f(gl.getUniformLocation(program,
        "shininess"), materialShininess);

    gl.useProgram(meshProgramInfo.program);

    // calls gl.uniform
    webglUtils.setUniforms(meshProgramInfo, sharedUniforms);

    // calls gl.bindBuffer, gl.enableVertexAttribArray, gl.vertexAttribPointer
    webglUtils.setBuffersAndAttributes(gl, meshProgramInfo, bufferInfo);

    // calls gl.uniform
    
    webglUtils.setUniforms(meshProgramInfo, {
      u_world: m4.yRotation(time),
      u_diffuse: [1, 0.7, 0.5, 1],
    });

    // calls gl.drawArrays or gl.drawElements
    webglUtils.drawBufferInfo(gl, bufferInfo);

    requestAnimationFrame(render);
  }